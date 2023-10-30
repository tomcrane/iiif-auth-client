const ACCESS_TYPE = "AuthAccessService2";
const PROBE_TYPE = "AuthProbeService2";
const TOKEN_TYPE = "AuthAccessTokenService2";
const MANIFEST_TYPE = "Manifest";

const IMAGE_SERVICE_PROTOCOL = "http://iiif.io/api/image";
const IMAGE_SERVICE_TYPE = 'ImageService2'; // for the purposes of this demo all image services will be given this type if they don't come with a type

const PROFILE_INTERACTIVE = 'active';
const PROFILE_KIOSK = 'kiosk';
const PROFILE_EXTERNAL = 'external';

let viewer = null;
let dashPlayer = null;
let messages = {};
let sourcesMap = {}; // The loaded carrier of the authed resource
let authedResourceMap = {}; // the actual resource - might be an image service, might be a video or a pdf.

// Listen for IIIF Auth PostMessage calls from the token service
window.addEventListener("message", receiveMessage, false);


function init(){

    const searchParams = new URLSearchParams(window.location.search);
    const imageServiceParam = searchParams.get("image");
    const collectionParam = searchParams.get("collection");
    const manifestParam = searchParams.get("manifest");

    sourcesMap = {};
    document.querySelector("h1").innerText = "(no resource on query string)";

    if(imageServiceParam)
    {
        // Load a IIIF Image Service directly, allow /info.json form or id
        let imageServiceId = imageServiceParam.replace(/\/info\.json$/, '');
        fetch(imageServiceId + "/info.json").then(response => response.json().then(info => {
            sourcesMap[imageServiceId] = info;
            selectResource(imageServiceId); // we can select it immediately, there's only one
        }));
    } else {
        if(collectionParam)
        {
            // Load a IIIF Collection of Manifests
            fetch(collectionParam).then(response => response.json().then(sources => {
                populateSourceList(sources); // There are multiple Manifests to choose from
            }));
        }
        if(manifestParam)
        {
            // Load a single Manifest
            fetch(manifestParam).then(response => response.json().then(manifest => {
                expandServices(manifest);
                sourcesMap[manifest.id] = manifest;
                selectResource(manifest.id); // we can select it immediately
                const sourceList = document.getElementById("sourceList");
                if(sourceList && sourceList.options?.length){
                    for(let i=0; i<sourceList.options.length; i++){
                        let opt = sourceList.options[i];
                        opt.selected = opt.value == manifest.id;
                    }
                }
            }));
        }
    }
}


function populateSourceList(sources){
    // A IIIF Collection was supplied, so populate the dropdown.
    sourcesMap = {};
    let sourceList = document.getElementById("sourceList");
    sources.items.forEach(manifest => {
        let opt = document.createElement("option");
        opt.value = manifest.id;
        opt.innerText = manifest.label["en"][0];
        sourceList.appendChild(opt);
        sourcesMap[manifest.id] = manifest;
    });
    sourceList.style.display = "block";
    sourceList.addEventListener("change", () => {
        let manifestId = sourceList.options[sourceList.selectedIndex].value;
        selectResource(manifestId);
        let searchParams = new URLSearchParams(window.location.search)
        searchParams.set("manifest", manifestId);
        let newRelativePathQuery = window.location.pathname + '?' + searchParams.toString();
        history.pushState(null, '', newRelativePathQuery);
    });
    let reloadButton = document.getElementById("reloadSource");
    reloadButton.style.display = "block";
    reloadButton.addEventListener("click", () => {
        selectResource(sourceList.options[sourceList.selectedIndex].value);
    });
}


function selectResource(resourceId){

    let sourceResource = sourcesMap[resourceId];
    if(!sourceResource){
        log("No resource in sources for resourceId: " + resourceId);
        return;
    }
    if(sourceResource.type === MANIFEST_TYPE && !sourceResource.hasOwnProperty("items")){
        // This is still the reference to the Manifest from the original collection
        fetch(sourceResource.id).then(response => response.json()).then(data => {
            expandServices(data);
            sourcesMap[resourceId] = data;
            selectResource(resourceId);
        });
        return;
    }
    document.querySelector("h1").innerText = resourceId;
    let resourceAnchor = document.getElementById("resourceUrl");
    resourceAnchor.innerText = resourceId;
    resourceAnchor.href = resourceId;

    // TODO inspect protocol and profile for "iiif.io/api/image"
    if(ensureIsTypedImageService(sourceResource))
    {
        resourceAnchor.href += "/info.json";
    }

    selectMediaResource(sourceResource);
}



function selectMediaResource(sourceResource){

    let res;
    if(sourceResource.type === MANIFEST_TYPE){
        // just take the first resource on the first canvas, but look for renderings too
        // Only accept v3 Manifests
        const canvas = sourceResource.items[0];
        // we want to demo auth on PDFs, etc., so if this special behavior is present we'll
        // assume the authed resource is a rendering, and not in the body of a painting anno.
        // A real viewer should deal with auth on any resource, but our special viewer only
        // deals with one authed resource per source.
        if(canvas["behavior"] && canvas["behavior"].includes("placeholder")){
            res = first(canvas["rendering"], r => r["behavior"] && r["behavior"].includes("original"));
        } else {
            res = canvas.items[0].items[0].body;
        }
        if(res["service"]){
            // Pick either v2 or v3 image service from a v3 Manifest
            const svc = first(res["service"], s => ((s["@type"] || s["type"]) || "").startsWith("ImageService"));
            if(svc){
                // load the full image service, so we can see its auth services
                fetch(svc["@id"] || svc["id"])
                    .then(resp => resp.json())
                    .then(json => {
                        if(ensureIsTypedImageService(json))
                        {
                            loadResource(json);
                        }
                    });
                return;
            }
        }
    }
    loadResource(res || sourceResource);
}



/*
    ======================================================================================================
    Up to this point we have just been setting up our test application, handling the loading of different
    test fixtures. We now have a IIIF Resource API (JSON-LD from a Manifest, info.json etc) description of
    a potentially access-controlled resource.
    ======================================================================================================
 */

function loadResource(sourceResource){
    let authedResourceInfo = getAuthedResourceInfo(sourceResource)
    authedResourceMap[authedResourceInfo.id] = authedResourceInfo;

    getProbeResponse(authedResourceInfo.id, null).then(probedResource => {
        if(probedResource.status === 200 || probedResource.substitute){
            // we have something to show, even if there's more available after auth
            renderResource(authedResourceInfo.id);
        }
        if(probedResource.status === 401 || probedResource.substitute){
            doAuthChain(probedResource).then(() => log("Auth Chain Completed"));
        }
    }).catch(e => {
        log("Could not load " + authedResourceInfo.id);
        log(e);
    });
}


function getAuthedResourceInfo(actualResource){
    // returns an object that represents a content resource or image service and its probe service,
    // and info about the user's relationship with the resource.
    // You don't have to do it like this - this is an implementation detail.

    // Update Jan 2023 - this makes an assumption that a resource could have many access services but only has one
    // probe service. In the latest spec draft this is not the case
    const authResource = {
        originalResource: actualResource,
        // tidied up properties of the resource itself
        id: null,
        type: null,
        format: null,
        probe: null,
        accessServices: [],
        // These last props will change as the user goes through the auth flow.
        status: 0,
        substitute: null,
        error: null
    }

    authResource.id = actualResource["@id"] || actualResource["id"];
    authResource.type = actualResource["type"] || actualResource["@type"];
    authResource.format = actualResource["format"]; // often null

    const probeService = first(actualResource["service"], s => s["type"] === PROBE_TYPE);
    if(probeService){
        authResource.probe = probeService.id;
        authResource.accessServices = probeService["service"].filter(s => s["type"] === ACCESS_TYPE);
    }

    // old version with resource -> accessService -> probe structure
    //authResource.probe = first(actualResource["service"], s => s["type"] === PROBE_TYPE)?.id;
    //authResource.accessServices = asArray(actualResource["service"]).filter(s => s["type"] === ACCESS_TYPE);

    return authResource;
}

// resolve returns { infoJson, status }
// reject returns an error message
async function getProbeResponse(authedResourceId, token){

    // updates the authedResource with information about the user's relationship with the resource,
    // by requesting the probe service (which may be the resource itself).

    let authedResource = authedResourceMap[authedResourceId];
    if (!authedResource.accessServices || !authedResource.accessServices.length) {
        // no presence of, or possibility of auth; we don't want to send a token
        // because that imposes CORS reqts on the server that they might
        // not support because their content is open.
        authedResource.status = 200;
        return authedResource;
    }

    log("Probe will be requested with HTTP GET");

    const settings = { method: "GET", mode: "cors" };

    if(token){
        settings.headers = {
            "Authorization": "Bearer " + token
        }
    }
    const probeRequest = new Request(authedResource.probe, settings);

    authedResource.status = 0;
    authedResource.substitute = null;

    try
    {
        let response = await fetch(probeRequest);
        // authedResource.status = response.status; // no longer the HTTP response status
        let probeBody = await response.json();
        authedResource.status = probeBody.status;
        authedResource.substitute = probeBody.substitute;
    }
    catch (error){
        authedResource.error = error;
    }

    return authedResource;
}


function renderResource(requestedResourceId){
    destroyViewer();
    const authedResource = authedResourceMap[requestedResourceId];
    if(authedResource.substitute){
        // For now, we will not handle the possibility of the substitute having further auth services
        log("The probe offered a substitute of " + authedResource.substitute.id);
        log("This resource is most likely the degraded version of the one you asked for");
    }
    // if(authedResource.type === IMAGE_SERVICE_TYPE){
    if(ensureIsTypedImageService(authedResource)){
        log("This resource is an image service.");
        if(authedResource.substitute){
            log("Fetch the info.json for the 'degraded' resource at " + authedResource.substitute.id);
            fetch(authedResource.substitute.id)
                .then(resp => resp.json())
                .then(json => {
                    if(ensureIsTypedImageService(json))
                    {
                        loadResource(json);
                    }
                });
        } else {
            renderImageService(authedResource.originalResource);
        }
    } else {
        log("The resource is of type " + authedResource.type);
        log("The resource is of format " + authedResource.format);
        let viewerHTML;
        let isDash = (authedResource.format === "application/dash+xml");
        let resourceUrl = authedResource.substitute?.id || authedResource.id;
        if(authedResource.type === "Video"){
            viewerHTML = `<video id='html5AV' src='${resourceUrl}' autoplay>Video here</video>`;
        } else if(authedResource.type === "Audio"){
            viewerHTML = `<audio id='html5AV' src='${resourceUrl}' autoplay>audio here</audio>`;
        } else if(authedResource.type === "Text" || authedResource.type === "PhysicalObject"){
            viewerHTML = `<a href='${authedResource.id}' target='_blank'>Open document in new window</a>`;
        } else {
            viewerHTML = "<p>Not a known type</p>";
        }
        document.getElementById("viewer").innerHTML = viewerHTML;
        if(isDash){
            dashPlayer = dashjs.MediaPlayer().create();
            // Only send credentials for a DASH request if an auth service was present on the resource.
            let withCredentials = authedResource.accessServices?.length ? true : false;
            dashPlayer.setXHRWithCredentialsForType("MPD", withCredentials);
            // There's also
            // dashPlayer.setXHRWithCredentialsForType("MediaSegment", true);
            // dashPlayer.setXHRWithCredentialsForType("InitializationSegment", true);
            // whether these get sent depends on whether the segment parts are authed with cookies,
            // or with token fragments.
            // TODO: How do we avoid the client having to work this out?
            dashPlayer.initialize(document.querySelector("#html5AV"), resourceUrl, false);

            // TODO - this is not getting destroyed correctly
        }
    }
}

function destroyViewer(){
    if(viewer){
        viewer.destroy();
        viewer = null;
    }
    dashPlayer = null;
    document.getElementById("viewer").innerHTML = "";
    document.getElementById("largeDownload").innerHTML = "";
    document.getElementById("contentResourceLink").innerHTML = "";
}

function renderImageService(imageService){
    const id = (imageService.id || imageService["@id"]);
    log("OSD will load " + id);
    viewer = OpenSeadragon({
        id: "viewer",
        prefixUrl: "openseadragon/images/",
        tileSources: imageService
    });
    makeDownloadLink(imageService);
    makeContentResourceLink(id, "Link to IIIF Image Service");
}

function makeDownloadLink(imageService){
    let largeDownload = document.getElementById("largeDownload");
    let w = imageService["width"];
    let h = imageService["height"]
    let dims = "(" + w + " x " + h + ")";
    let maxWAssertion = first(imageService["profile"], pf => pf["maxWidth"]);
    if(maxWAssertion){
        dims += " (max width is " + maxWAssertion["maxWidth"] + ")";
    }
    largeDownload.innerText = "Download large image: " + dims;
    const id = (imageService.id || imageService["@id"]);
    largeDownload.setAttribute("href", id + "/full/full/0/default.jpg")
}

function makeContentResourceLink(href, text){
    let contentResourceLink = document.getElementById("contentResourceLink");
    contentResourceLink.innerText = text;
    contentResourceLink.setAttribute("href", href);
}


async function attemptResourceWithToken(authService, resourceId){
    let authedResource = authedResourceMap[resourceId];
    log("attempting token interaction for " + authedResource.id);
    let tokenService = first(authService.service, s => s.type === TOKEN_TYPE);
    const result = {
        success: false,
        tokenService: tokenService,
        tokenMessage: null
    };
    if(tokenService){
        log("found token service: " + tokenService.id);
        result.tokenMessage = await openTokenService(tokenService);
        // TODO - deal with the token error response, use the error messages returned or the ones on the token service if none,
        // store them for later display
        if(result.tokenMessage?.accessToken){
            try{
                authedResource = await getProbeResponse(resourceId, result.tokenMessage.accessToken);
            } catch (e) {
                log("attemptResourceWithToken - could not load " + resourceId);
                log(e);
                return result;
            }
            log("info request with token resulted in " + authedResource.status);
            if(authedResource.status === 200 || authedResource.substitute){
                renderResource(resourceId);
                if(authedResource.status === 200){
                    result.success = true;
                    return result;
                }
            }
        }
    }
    log("Didn't get a 200 info response.")
    return result;
}

async function doAuthChain(authedResource){
    // This function enters the flowchart at the < External? > junction
    // http://iiif.io/api/auth/1.0/#workflow-from-the-browser-client-perspective
    if(!authedResource.accessServices){
        log("No services found")
        return;
    }
    let lastAttempted = null;
    let authFlowResult = null;

    // repetition of logic is left in these steps for clarity:

    log("Looking for external pattern");
    let serviceToTry = first(authedResource.accessServices, s => s.profile === PROFILE_EXTERNAL);
    if(serviceToTry){
        lastAttempted = serviceToTry;
        authFlowResult = await attemptResourceWithToken(serviceToTry, authedResource.id);
        if(authFlowResult.success) return;
    }

    log("Looking for kiosk pattern");
    serviceToTry = first(authedResource.accessServices, s => s.profile === PROFILE_KIOSK);
    if(serviceToTry){
        lastAttempted = serviceToTry;
        let kioskWindow = openContentProviderWindow(serviceToTry);
        if(kioskWindow){
            await userInteractionWithContentProvider(kioskWindow);
            authFlowResult = await attemptResourceWithToken(serviceToTry, authedResource.id);
            if(authFlowResult.success) return;
        } else {
            log("Could not open kiosk window");
        }
    }

    log("Looking for active pattern");
    serviceToTry = first(authedResource.accessServices, s => s.profile === PROFILE_INTERACTIVE);
    if(serviceToTry){
        lastAttempted = serviceToTry;
        let contentProviderWindow = await getContentProviderWindowFromModal(serviceToTry);
        if(contentProviderWindow){
            await userInteractionWithContentProvider(contentProviderWindow);
            authFlowResult = await attemptResourceWithToken(serviceToTry, authedResource.id);
            if(authFlowResult.success) return;
        } else {
            log("User cancelled interaction with access service");
            authFlowResult = {
                // These strings don't belong on the services, because the reason is client-controlled
                cancelHeading: { "en": [ "Interaction cancelled" ]},
                cancelNote: { "en": [ "You cancelled a visit to the active service." ]}
            }
        }
    }

    // nothing worked! Use the most recently tried service as the source of
    // messages to show to the user.
    showOutOfOptionsMessages(lastAttempted, authFlowResult);
}

function* MessageIdGenerator(){
    let messageId = 1; // don't start at 0, it's false-y
    while(true) yield messageId++;
}

const messageIds = MessageIdGenerator();

function openTokenService(tokenService){
    // use a Promise across a postMessage call. Discuss...
    return new Promise((resolve, reject) => {
        // if necessary, the client can decide not to trust this origin
        const serviceOrigin = getOrigin(tokenService.id);
        const messageId = messageIds.next().value;
        messages[messageId] = {
            "resolve": resolve,
            "reject": reject,
            "serviceOrigin": serviceOrigin
        };
        const tokenUrl = tokenService.id + "?messageId=" + messageId + "&origin=" + getOrigin();
        document.getElementById("commsFrame").src = tokenUrl;

        // reject any unhandled messages after a configurable timeout
        const postMessageTimeout = 5000;
        setTimeout(() => {
            if(messages[messageId]){
                messages[messageId].reject(
                    "Message unhandled after " + postMessageTimeout + "ms, rejecting");
                delete messages[messageId];
            }
        }, postMessageTimeout);
    });
}

/*
 The event listener for postMessage. Needs to take care it only
 responds to messages initiated by openTokenService(..)
 Completes promises made in openTokenService(..)
 */
function receiveMessage(event) {
    log("event received, origin=" + event.origin);
    log(JSON.stringify(event.data));
    let rejectValue = "postMessage event received but rejected.";
    if(event.data.hasOwnProperty("messageId")){
        log("received message with id " + event.data.messageId);
        const message = messages[event.data.messageId];
        if(message && event.origin === message.serviceOrigin)
        {
            // Any message with a messageId is a success
            log("We trust that we triggered this message, so resolve")
            message.resolve(event.data);
            delete messages[event.data.messageId];
        }
    }
}

/*
    Await the closing of the opened access service window
 */
function userInteractionWithContentProvider(contentProviderWindow){
    return new Promise((resolve) => {
        // What happens here is forever a mystery to a client application.
        // It can but wait.
        const poll = window.setInterval(() => {
            if (contentProviderWindow.closed) {
                log("active service window is now closed");
                window.clearInterval(poll);
                resolve();
            }
        }, 500);
    });
}

function getDisplayText(langMap, allowHtml){
    // This would extract the relevant language text from the language map, and sanitise HTML for output.
    // Sanitisation unimplemented, viewers should already have an HTML sanitiser library, for metadata etc
    if(allowHtml){
        // sanitise but allow permitted tags
        return Object.entries(langMap)[0][1];
    }
    // return text content only
    return Object.entries(langMap)[0][1];
}

/*
 Open a new tab/window on the content provider's access service
 */
function openContentProviderWindow(service){
    let interactiveServiceUrl = service.id + "?origin=" + getOrigin();
    log("Opening content provider window: " + interactiveServiceUrl);
    return window.open(interactiveServiceUrl);
}

/*
    Present a user interface from the strings included in the IIIF Auth Services.
    The aim of the modal dialog is to get the user to click on something that opens a new tab
    for the content provider's access service.

    The implementation doesn't have to be modal - it could be "to the side" of the viewer, or
    anywhere else.
 */
function getContentProviderWindowFromModal(service){
    return new Promise(resolve => {
        hideModals();
        let modal = document.getElementById("beforeOpenInteractiveServiceModal");
        modal.querySelector(".close").onclick = (ev => {
            hideModals();
            resolve(null);
        });
        modal.querySelector("#csConfirm").onclick = (ev => {
            log("Interacting with service in new tab - " + service.id);
            let win = openContentProviderWindow(service);
            hideModals();
            resolve(win);
        });
        modal.querySelector("#csCancel").onclick = (ev => {
            hideModals();
            resolve(null);
        });
        if(service.label){
            modal.querySelector("#csLabel").innerText = getDisplayText(service.label);
        }
        if(service.heading){
            modal.querySelector("#csHeader").innerText = getDisplayText(service.heading);
        }
        if(service.note){
            modal.querySelector("#csDescription").innerText = getDisplayText(service.note, true);
        }
        if(service.confirmLabel){
            modal.querySelector("#csConfirm").innerText = getDisplayText(service.confirmLabel);
        }
        modal.style.display = "block";
    });
}

function showOutOfOptionsMessages(service, authFlowResult){
    hideModals();
    let modal = document.getElementById("failureModal");
    modal.querySelector(".close").onclick = (ev => hideModals());
    modal.querySelector("#failureClose").onclick = (ev => hideModals());
    // Need to demonstrate the probe headline and note usage too.
    let errorHeading = authFlowResult.cancelHeading || authFlowResult.tokenMessage?.heading || authFlowResult.tokenService?.errorHeading;
    let errorNote = authFlowResult.cancelNote || authFlowResult.tokenMessage?.note || authFlowResult.tokenService?.errorNote;
    if(errorHeading){
        modal.querySelector("#errorHeading").innerText = getDisplayText(errorHeading);
    }
    if(errorNote){
        modal.querySelector("#errorNote").innerText = getDisplayText(errorNote, true);
    }
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

function ensureIsTypedImageService(resource){
    // Determines whether a resource is an image service, and if so, assigns it a type
    // if it doesn't have one. This makes latertype checking simpler.
    let type = resource["type"] || resource["@type"];
    if(type && type.startsWith("ImageService")){
        resource.type = type; // in case @type
        return true;
    }
    if(resource.protocol && resource.protocol === IMAGE_SERVICE_PROTOCOL){
        resource.type = IMAGE_SERVICE_TYPE;
        return true;
    }
    if(resource.profile){
        let profile = asArray(resource.profile);
        if(profile[0] && profile[0].contains("iiif.io/api/image")){
            resource.type = IMAGE_SERVICE_TYPE;
            return true;
        }
    }
    return false;
}

init();



/*********************************** Utils ***********************************/

function asArray(obj){
    // wrap in array if singleton
    if(obj){
        return (obj.constructor === Array ? obj : [obj]);
    }
    return [];
}

function first(objOrArray, predicate){
    if(!objOrArray) return null;
    let arr = asArray(objOrArray);
    let filtered = arr.filter(predicate);
    if(filtered.length > 0){
        return filtered[0];
    }
    return null;
}

function log(text) {
    const logDiv = document.querySelector("#usermessages");
    const p = document.createElement("p");
    p.innerText = text;
    logDiv.appendChild(p);
    logDiv.scrollTop = logDiv.scrollHeight;
    console.log(text);
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

function expandServices(manifest){
    if(!manifest.hasOwnProperty("services")) return;
    let serviceMap = Object.fromEntries(manifest.services.map(svc => [(svc.id || svc["@id"]), svc]));
    traverseForServices(manifest, serviceMap);
}

function traverseForServices(obj, serviceMap) {
    for (let key in obj) {
        if(key == "services") continue;

        if (typeof obj[key] === "object") {
            if (Array.isArray(obj[key])) {
                for (let i = 0; i < obj[key].length; i++) {
                    let replacement = getExpandedService(obj[key][i], serviceMap);
                    if(replacement){
                        obj[key][i] = replacement;
                    } else {
                        traverseForServices(obj[key][i], serviceMap);
                    }
                }
            } else {
                let replacement = getExpandedService(obj[key], serviceMap);
                if(replacement){
                    obj[key] = replacement;
                } else {
                    traverseForServices(obj[key], serviceMap);
                }
            }
        }
    }
}

function getExpandedService(possibleServiceRef, serviceMap){
    // Only going to look for valid P3 references now:
    // { id: xxx, type: yyy }
    if(typeof possibleServiceRef === "object" && !Array.isArray(possibleServiceRef)){
        let keys = Object.keys(possibleServiceRef);
        if(keys.length == 2 && keys.includes("id") && keys.includes("type")){
            let fullService = serviceMap[possibleServiceRef.id];
            if(fullService){
                log("replacing reference: " + JSON.stringify(possibleServiceRef));
            }
            return fullService;
        }
    }
    return null;
}