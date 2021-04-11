let messages = {};

// wire up a handler to receive PostMessage messages from the #commsFrame iframe
window.addEventListener("message", receiveMessage, false);

// You can see any image you like as long as it's one of these two.
function init(){
    Array.from(document.getElementsByClassName("loadbutton")).forEach(
        btn => btn.addEventListener("click", () => {
            selectImage(btn.getAttribute("data-iiif-content"));
    }));
}

function selectImage(imageUri){
    log("-START---------------------------------------------");
    log("New interaction....");
    document.querySelector("h3").innerText = imageUri;
    loadServiceForImage(imageUri).then(infoResponse => {
        if(infoResponse && infoResponse.status === 401){
            // We probed the image service description and got an HTTP 401; we need to send the user on an auth journey
            doAuthChain(infoResponse).then(() =>
                log("-END---------------------------------------------\r\n")
            );
        }
    });
}

async function loadServiceForImage(imageUri, token){
    let serviceResponse;
    try{
        log("Request the service description for " + imageUri);
        serviceResponse = await getServiceResponse(imageUri, token);
    } catch (e) {
        log("Could not load " + imageUri);
        log(e);
    }
    if(serviceResponse && serviceResponse.status === 200){
        log("An HTTP 200 response was received from the service, we know we can display the image.");
        renderImage(imageUri);
    }
    return serviceResponse;
}

// resolve returns { infoJson, status }
// reject returns an error message
function getServiceResponse(imageUri, token){
    let info = null;
    let serviceForImage = imageUri + "/info.json"; // a convention
    log("Making a GET request for " + serviceForImage);
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("GET", serviceForImage);
        if(token){
            request.setRequestHeader("Authorization", "Bearer " + token);
        }
        request.onload = function(){
            try {
                if (this.status === 200 || this.status === 401) {
                    log("Service response is:")
                    log(this.response);
                    info = JSON.parse(this.response);
                    resolve({
                        info: info,
                        status: this.status,
                        requestedUri: imageUri
                    });
                } else {
                    reject(this.status + " " + this.statusText);
                }
            } catch (e) {
                reject(e.message);
            }
        };
        request.onerror = function() {
            reject(this.status + " " + this.statusText);
        };
        request.send();
    });
}


function renderImage(imageUri){
    log("Simplest possible viewer - just emit an image tag.");
    document.getElementById("viewer").innerHTML = "<img src='" + imageUri + "' alt='example' />";
}


async function doAuthChain(infoResponse){
    // This function enters the flowchart at the < External? > junction
    // http://iiif.io/api/auth/1.0/#workflow-from-the-browser-client-perspective
    let authService = infoResponse.info.authService;
    if(!authService){
        log("No auth service found")
        return;
    }
    log("Found an auth service for this image, at " + authService.id);
    let contentProviderWindow = await getContentProviderWindowFromModal(authService);
    if(contentProviderWindow){
        await userInteractionWithContentProvider(contentProviderWindow);
        let success = await attemptImageWithToken(authService, infoResponse.requestedUri, false);
        if(success) return;
    }

    showFailureMessage(authService);
}


async function attemptImageWithToken(authService, imageUri, isRetry){
    log("Attempting token interaction for " + authService.id + " at " + authService.tokenService);
    log("isRetry: " + isRetry);
    let tokenMessage = await openTokenService(authService.tokenService, isRetry);
    if(tokenMessage && tokenMessage.accessToken){
        let withTokenInfoResponse = await loadServiceForImage(imageUri, tokenMessage.accessToken);
        log("Info request with token resulted in " + withTokenInfoResponse.status);
        if(withTokenInfoResponse.status === 200){
            renderImage(imageUri);
            return true;
        }
    } else if (tokenMessage.error && tokenMessage.error == "missingCredentials"){
        if(tokenMessage.userInteractionState == "requestStorageAccessSucceeded" && tokenMessage.frameHasStorageAccess){
            log("We've just been given storage access. Try the token service again.");
            let success = await attemptImageWithToken(authService, imageUri, true);
            if(success){
                log("Second time round we got a working token!")
                return true;
            }
        } else if (tokenMessage.userInteractionState == "requestStorageAccessFailed"){
            log("We failed to obtain storage access, let's send the user to really interact with the server in a first party context")
            let firstPartyWindow = window.open(authService.storageAccessInteractionPage);
            await userInteractionWithContentProvider(firstPartyWindow);
            let success = await attemptImageWithToken(authService, imageUri, true);
            if(success) {
                log("Second time round trying the image with a token succeeded.")
                return true;
            }
        } else if (tokenMessage.userInteractionState == "stillNoCredentials") {
            log("Server is still not seeing user's cookies.");
            alert("Server is still not seeing your cookies. Do you have _ALL_ third party cookies disabled?");
        }
    }

    log("Didn't get a 200 info response.")
    return false;
}



// determine the postMessage-style origin for a URL
function getOrigin(url) {
    let urlHolder = window.location;
    if(url){
        urlHolder = document.createElement('a');
        urlHolder.href = url;
    }
    return urlHolder.protocol + "//" + urlHolder.hostname + (urlHolder.port ? ':' + urlHolder.port: '');
}

function* MessageIdGenerator(){
    let messageId = 1; // don't start at 0, it's falsey
    while(true) yield messageId++;
}

const messageIds = MessageIdGenerator();

function openTokenService(tokenService, isRetry){
    // using a Promise across a postMessage call. Discuss... is that an OK thing to do?
    return new Promise((resolve, reject) => {
        // if necessary, the client can decide not to trust this origin
        const serviceOrigin = getOrigin(tokenService);
        const messageId = messageIds.next().value;
        messages[messageId] = { 
            "resolve": resolve,
            "reject": reject,
            "serviceOrigin": serviceOrigin
        };
        let tokenUrl = tokenService + "?messageId=" + messageId + "&origin=" + getOrigin() + "&isRetry=" + isRetry;
        log("Setting the iframe src to " + tokenUrl);
        document.getElementById("commsFrame").src = tokenUrl;

        // reject any unhandled messages after a configurable timeout
        const postMessageTimeout = 60000; // increase this to 1 minute. Maybe indefinite?
        setTimeout(() => {
            if(messages[messageId]){
                messages[messageId].reject(
                    "Message unhandled after " + postMessageTimeout + "ms, rejecting");
                delete messages[messageId];
            }
        }, postMessageTimeout);
    });
}

// The event listener for postMessage. Needs to take care it only
// responds to messages initiated by openTokenService(..)
// Completes promises made in openTokenService(..)
function receiveMessage(event) {

    // This is not part of the normal flow, just added it get log messages from the frame displayed in our test viewer.
    if(event.data.log){
        log("POSTMESSAGE IFRAME LOG: " + event.data.log, "33a");
        return;
    }

    // We've received a message from the postMessage iframe asking us to make it visible to the user
    if("show" === event.data.userInteractionRequest){
        showServerInteractionModal();
        return;
    }

    // We've received a message from the postMessage iframe saying that the user clicked within the iframe
    if("clicked" === event.data.userInteractionRequest){
        hideModals(); // close the popup
        return;
    }

    // Normal flow resumes
    log("PostMessage Event received, origin=" + event.origin);
    log(JSON.stringify(event.data));
    // two kinds of message here - the token original, and the "show me to request storage access"
    if(event.data.hasOwnProperty("messageId")){
        log("Received message with id " + event.data.messageId);
        let message = messages[event.data.messageId];


        if(message && event.origin == message.serviceOrigin)
        {
            // Have we just received a token, or have
            // Any message with a messageId is a success for our demo
            log("We trust that we triggered this message, so resolve")
            message.resolve(event.data);
            delete messages[event.data.messageId];
            return;
        }    
    }
}

function userInteractionWithContentProvider(contentProviderWindow){
    return new Promise((resolve) => {
        // What happens here is forever a mystery to a client application.
        // It can but wait.
        let poll = window.setInterval(() => {
            log("Waiting for window to close...")
            if(contentProviderWindow.closed){
                log("Cookie service window is now closed.")
                window.clearInterval(poll);
                resolve();
            }
        }, 500);
    });
}

function sanitise(s, allowHtml){
    // UNIMPLEMENTED
    // Viewers should already have an HTML sanitiser library, for metadata etc
    if(allowHtml){
        // sanitise but allow permitted tags
        return s;
    }
    // return text content only
    return s;
}

function openContentProviderWindow(authService){
    let cookieServiceUrl = authService.id + "?origin=" + getOrigin();
    log("Opening content provider window: " + cookieServiceUrl);
    return window.open(cookieServiceUrl);
}

function getContentProviderWindowFromModal(authService){
    return new Promise(resolve => {
        hideModals();
        let modal = document.getElementById("beforeOpenCookieServiceModal");
        modal.querySelector(".close").onclick = (ev => {
            hideModals();
            resolve(null);
        });
        modal.querySelector("#csConfirm").onclick = (ev => {
            log("Interacting with cookie service in new tab or window - " + authService.id);
            let win = openContentProviderWindow(authService);
            hideModals();
            resolve(win);
        });
        modal.querySelector("#csCancel").onclick = (ev => {
            hideModals();
            resolve(null);
        });
        if(authService.label){
            modal.querySelector("#csLabel").innerText = sanitise(authService.label);
        }
        if(authService.header){
            modal.querySelector("#csHeader").innerText = sanitise(authService.header);
        }
        if(authService.description){
            modal.querySelector("#csDescription").innerText = sanitise(authService.description, true);
        }
        if(authService.confirmLabel){
            modal.querySelector("#csConfirm").innerText = sanitise(authService.confirmLabel);
        }
        modal.style.display = "block";
    });
}

function showFailureMessage(authService){
    hideModals();
    let modal = document.getElementById("failureModal");
    modal.querySelector(".close").onclick = (ev => hideModals());
    modal.querySelector("#failureClose").onclick = (ev => hideModals());
    if(authService.failureHeader){
        modal.querySelector("#failureHeader").innerText = sanitise(authService.failureHeader);
    }
    if(authService.failureDescription){
        modal.querySelector("#failureDescription").innerText = sanitise(authService.failureDescription, true);
    }
    modal.style.display = "block";
}

function showServerInteractionModal(){
    hideModals();
    let modal = document.getElementById("serverInteractionModal");
    modal.querySelector(".close").onclick = (ev => hideModals());
    modal.style.display = "block";
}

function hideModals(){
    let modals = document.querySelectorAll(".modal");
    modals.forEach(m => {
        m.style.display = "none";
        m.querySelectorAll("*").forEach(el => {
            el.onclick = null;
        });
    });
}

function log(text, color) {
    let logDiv = document.querySelector("#log");
    let p = document.createElement("p");
    if(color) p.setAttribute("style", "color:#" + color);
    p.innerText = " - " + text;
    logDiv.appendChild(p);
    logDiv.scrollTop = logDiv.scrollHeight;
    console.log(text);
}

init();