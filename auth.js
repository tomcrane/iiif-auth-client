const AUTHED_RESOURCE_KEY = "authedResource_";
const ACCESS_TYPE = "AuthAccessService2";
const PROBE_TYPE = "AuthProbeService2"; 
const IMAGE_SERVICE_TYPE = 'ImageService3'; // for the purposes of this demo all image services will be given this type, even v2

const PROFILE_LOGIN = 'http://iiif.io/api/auth/1/login';
const PROFILE_CLICKTHROUGH = 'http://iiif.io/api/auth/1/clickthrough';
const PROFILE_KIOSK = 'http://iiif.io/api/auth/1/kiosk';
const PROFILE_EXTERNAL = 'http://iiif.io/api/auth/1/external';
const PROFILE_TOKEN = 'http://iiif.io/api/auth/1/token';
const PROFILE_LOGOUT = 'http://iiif.io/api/auth/1/logout';
const PROFILE_PROBE = 'http://iiif.io/api/auth/1/probe';
const HTTP_METHOD_GET = 'GET';
const HTTP_METHOD_HEAD = 'HEAD';

let viewer = null;   
let dashPlayer = null;   
let messages = {};
let sourcesMap = {}; // The loaded carrier of the authed resource
let authedResourceMap = {}; // the actual resource - might be an image service, might be a video or a pdf.
window.addEventListener("message", receiveMessage, false);


function init(){

    // See what has been supplied on the query string:
    // Is it an image service?
    const imageQs = /image=(.*)/g.exec(window.location.search);
    // Is it a Collection?
    const collQs = /collection=(.*)/g.exec(window.location.search);
    // Or is it a Manifest?
    const manifestQs = /manifest=(.*)/g.exec(window.location.search)

    sourcesMap = {};

    if(imageQs && imageQs[1])
    {
        // Load a IIIF Image Service directly, allow /info.json form or id
        let imageServiceId = imageQs[1].replace(/\/info\.json$/, '');
        fetch(imageServiceId + "/info.json").then(response => response.json().then(info => {
            sourcesMap[imageServiceId] = info;
            selectResource(imageServiceId); // we can select it immediately
        }));
    } 
    else if(collQs && collQs[1]) 
    {
        // Load a IIIF Collection of Manifests
        fetch(collQs[1]).then(response => response.json().then(sources => {
            populateSourceList(sources); // There are multiple Manifests to choose from
        }));
    } 
    else if(manifestQs && manifestQs[1]) 
    {
        // Load a single Manifest
        fetch(manifestQs[1]).then(response => response.json().then(manifest => {
            sourcesMap[manifest.id] = manifest;
            selectResource(manifest.id); // we can select it immediately
        }));    
    } 
    else 
    {
        document.querySelector("h1").innerText = "(no resource on query string)";
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
        selectResource(sourceList.options[sourceList.selectedIndex].value);
    });
    let reloadButton = document.getElementById("reloadSource");
    reloadButton.style.display = "block";    
    reloadButton.addEventListener("click", () => {
        selectResource(sourceList.options[sourceList.selectedIndex].value);
    }); 
}


function selectResource(resourceId){

    let resource = sourcesMap[resourceId];
    document.querySelector("h1").innerText = resourceId;
    let resourceAnchor = document.getElementById("resourceUrl");
    resourceAnchor.innerText = resourceId;
    resourceAnchor.href = resourceId;
    if(resource.protocol == "http://iiif.io/api/image")
    {
        resourceAnchor.href += "/info.json";
        if(resource["@id"]){
            // Give the image service a type even if it's a v2, so we can identify it quickly
            resource.type == IMAGE_SERVICE_TYPE;
        }
    }

    const authedResource = getAuthedResource(resource);
    authedResourceMap[authedResource.id] = authedResource;

    // here
    loadResource(authedResource.id).then(authResponse => {
        if(authResponse){
            if(authResponse.location || authResponse.status === 401){
                doAuthChain(authResponse);
            }
        }
    });
}


async function getAuthedResource(anyResource){

    // returns one of these:
    // An object that represents a content resource or image service and its probe service.
    const authedResource = {
        id: null,
        probe: null,
        method: null,
        accessServices: [],
        type: null,
        format: null,
        status: 0,        // These last props will change as the
        location: null,   // user goes through the auth flow.
        error: null,
        imageService: null
    }

    let res;
    if(anyResource.type == "Manifest"){
        // just take the first resource on the first canvas, but look for renderings too
        // Only accept v3 Manifests
        const canvas = anyResource.items[0];
        // we want to demo auth on PDFs, etc, so if this special behavior is present we'll
        // assume the authed resource is a rendering, and not in the body of a painting anno.
        // A real viewer should deal with auth on any resource, but our special viewer only
        // deals with one authed resource per source.
        if(canvas["behavior"] && canvas["behavior"].includes("placeholder")){
            res = first(canvas["rendering"], r => r["behavior"] && r["behavior"].includes("original"));
        } else {
            res = canvas.items[0].items[0].body;
        }
        if(res["service"]){
            const svc = res["service"][0];
            const svcType = svc["@type"] || svc["type"];
            if(svcType && svcType.startsWith("ImageService")){
                // This is inefficient, as we're going to _probe_ this again later
                // It simplifies the demo as we have the full info right now.
                fetch(svc["@id"] || svc["id"]).then(resp => resp.json()).then(json => res = json);
            }
        }
    }

    // We've now got the authed resource we want to render, rather than whatever was carrying it.
    authedResource.id = res["@id"] || res["id"];
    authedResource.type = res["type"] || res["@type"];
    authedResource.format = res["format"]; // often null
    authedResource.probe = authedResource.id; // unless there's a probe service, below
    authedResource.method = HTTP_METHOD_GET;
    if(authedResource.type.startsWith("ImageService")){
        authedResource.probe = authedResource.id + "/info.json";
        authedResource.imageService = res;
    } else {
        let explicitProbe = first(authedResource["service"], s => s["type"] == PROBE_TYPE);
        if(explicitProbe){
            authedResource.probe = explicitProbe.id;
        } else {
            // The resource is its own probe, but we won't use GET (it might be huge!)
            authedResource.method = HTTP_METHOD_HEAD;
        }
    }
    authedResource.accessServices = asArray(res["service"]).filter(s => s["type"] == ACCESS_TYPE);

    return authedResource;
}


async function loadResource(authedResourceId, token){
    // token is optional - you might not have it yet!
    let probedAuthResource;
    try{
        probedAuthResource = await getProbeResponse(authedResourceId, token);
    } catch (e) {
        log("Could not load " + authedResourceId);
        log(e);
    }
    if(probedAuthResource && probedAuthResource.status === 200){
        renderResource(authedResourceId);
    }
    return probedAuthResource;
}

// resolve returns { infoJson, status }
// reject returns an error message
function getProbeResponse(authedResourceId, token){
    
    // updates the authedResource with information about the user's relationship with the resource,
    // by requesting the probe service (which may be the resource itself).
    
    let authedResource = authedResourceMap[authedResourceId];
    log("Probe will be requested with HTTP " + authedResource.method);
    
    return new Promise((resolve, reject) => {

        
        if (!authedResource.accessServices || !authedResource.accessServices.length) {
            // no presence of, or possibility of auth; we don't know if the
            // resource will respond to a HEAD and we don't want to send a token
            // because that imposes CORS reqts on the server that they might 
            // not support because their content is open.
            authedResource.status = 200;
            resolve(authedResource);
        }

        const settings = {
            method: authedResource.method,
            mode: "cors"
        }
        if(token){
            settings.headers = {
                "Authorization": "Bearer " + token    
            }
        }
        const probeRequest = new Request(authedResource.probe, settings);

        fetch(probeRequest)
        .then(response => {
            authedResource.status = response.status;
            if(authedResource.method == HTTP_METHOD_GET){
                let probe = await response.json();
                authedResource.location = probe.location;
            }
            resolve(authedResource);
        })                
        .catch(error => {
            authedResource.error = error;
            reject(authedResource);
        });
    });
}


function renderResource(requestedResourceId){
    destroyViewer();
    const authedResource = authedResourceMap[requestedResourceId];
    if(authedResource.location && authedResource.location != requestedResourceId){
        log("The requested resource ID is " + requestedResourceId);
        log("The probe offered a location of " + authedResource.location);
        log("This resource is most likely the degraded version of the one you asked for");
    }
    if(authedResource.type == IMAGE_SERVICE_TYPE){
        log("This resource is an image service.");
        renderImageService(authedResource);
    } else {
        log("The resource is of type " + authedResource.type);
        log("The resource is of format " + authedResource.format);
        let viewerHTML;
        let isDash = (authedResource.format == "application/dash+xml");
        let resourceUrl = authedResource.location || authedResource.id;
        if(authedResource.type == "Video"){
            viewerHTML = "<video id='html5AV' src='" + resourceUrl + "' autoplay>Video here</video>";            
        } else if(authedResource.type == "Audio"){
            viewerHTML = "<audio id='html5AV' src='" + resourceUrl + "' autoplay>audio here</audio>";
        } else if(authedResource.type == "Text" || authedResource.type == "PhysicalObject"){
            viewerHTML = "<a href='" + authedResource.id + "' target='_blank'>Open document - " + authedResource.label + "</a>";
        } else {
            viewerHTML = "<p>Not a known type</p>";
        }
        document.getElementById("viewer").innerHTML = viewerHTML;
        if(isDash){
            dashPlayer = dashjs.MediaPlayer().create();
            // Only send credentials for a DASH request if an auth service was present on the resource.
            let withCredentials = authResponse.cookieService != null;
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
}

function renderImageService(authedResource){
    log("OSD will load " + authedResource.id);
    viewer = OpenSeadragon({
        id: "viewer",
        prefixUrl: "openseadragon/images/",
        tileSources: authedResource.imageService
    });
    makeDownloadLink(authedResource.imageService);
}

function makeDownloadLink(authedResource){
    let largeDownload = document.getElementById("largeDownload");
    let w = authedResource.imageService["width"];
    let h = authedResource.imageService["height"]
    let dims = "(" + w + " x " + h + ")";
    maxWAssertion = first(authedResource.imageService["profile"], pf => pf["maxWidth"]);
    if(maxWAssertion){
        dims += " (max width is " + maxWAssertion["maxWidth"] + ")";
    }
    largeDownload.innerText = "Download large image: " + dims;
    largeDownload.setAttribute("href", authedResource.id + "/full/full/0/default.jpg")
}

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

async function attemptResourceWithToken(authService, resourceId){
    const authedResource = authedResourceMap[resourceId];
    log("attempting token interaction for " + authedResource.id);
    // There could be a token service for each access service, but 


    // HERE - token service belongs to ... what?


    let tokenService = first(authedResource.accessServices[0], s => s.profile === PROFILE_TOKEN);
    if(tokenService){
        log("found token service: " + tokenService["@id"]);
        let tokenMessage = await openTokenService(tokenService); 
        if(tokenMessage && tokenMessage.accessToken){
            let withTokenauthResponse = await loadResource(resourceId, tokenMessage.accessToken);
            log("info request with token resulted in " + withTokenauthResponse.status);
            if(withTokenauthResponse.status == 200){
                renderResource(resourceId);
                return true;
            }
        }  
    }
    log("Didn't get a 200 info response.")
    return false;
}

async function doAuthChain(authResponse){
    // This function enters the flowchart at the < External? > junction
    // http://iiif.io/api/auth/1.0/#workflow-from-the-browser-client-perspective
    if(!authedResource.service){
        log("No services found")
        return;
    }
    let services = asArray(authedResource.service);
    let lastAttempted = null;
    let requestedId = authResponse.requestedId;

    // repetition of logic is left in these steps for clarity:
    
    log("Looking for external pattern");
    let serviceToTry = first(services, s => s.profile === PROFILE_EXTERNAL);
    if(serviceToTry){
        lastAttempted = serviceToTry;
        let success = await attemptResourceWithToken(serviceToTry, requestedId);
        if(success) return;
    }

    log("Looking for kiosk pattern");
    serviceToTry = first(services, s => s.profile === PROFILE_KIOSK);
    if(serviceToTry){
        lastAttempted = serviceToTry;
        let kioskWindow = openContentProviderWindow(serviceToTry);
        if(kioskWindow){
            await userInteractionWithContentProvider(kioskWindow);
            let success = await attemptResourceWithToken(serviceToTry, requestedId);
            if(success) return;
        } else {
            log("Could not open kiosk window");
        }
    }

    // The code for the next two patterns is identical (other than the profile name).
    // The difference is in the expected behaviour of
    //
    //    await userInteractionWithContentProvider(contentProviderWindow);
    // 
    // For clickthrough the opened window should close immediately having established
    // a session, whereas for login the user might spend some time entering credentials etc.

    log("Looking for clickthrough pattern");
    serviceToTry = first(services, s => s.profile === PROFILE_CLICKTHROUGH);
    if(serviceToTry){
        lastAttempted = serviceToTry;
        let contentProviderWindow = await getContentProviderWindowFromModal(serviceToTry);
        if(contentProviderWindow){
            // should close immediately
            await userInteractionWithContentProvider(contentProviderWindow);
            let success = await attemptResourceWithToken(serviceToTry, requestedId);
            if(success) return;
        } 
    }

    log("Looking for login pattern");
    serviceToTry = first(services, s => s.profile === PROFILE_LOGIN);
    if(serviceToTry){
        lastAttempted = serviceToTry;
        let contentProviderWindow = await getContentProviderWindowFromModal(serviceToTry);
        if(contentProviderWindow){
            // we expect the user to spend some time interacting
            await userInteractionWithContentProvider(contentProviderWindow);
            let success = await attemptResourceWithToken(serviceToTry, requestedId);
            if(success) return;
        } 
    }

    // nothing worked! Use the most recently tried service as the source of
    // messages to show to the user.
    showOutOfOptionsMessages(lastAttempted);
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
    var messageId = 1; // don't start at 0, it's falsey
    while(true) yield messageId++;
}

var messageIds = MessageIdGenerator();

function openTokenService(tokenService){
    // use a Promise across a postMessage call. Discuss...
    return new Promise((resolve, reject) => {
        // if necessary, the client can decide not to trust this origin
        const serviceOrigin = getOrigin(tokenService["@id"]);
        const messageId = messageIds.next().value;
        messages[messageId] = { 
            "resolve": resolve,
            "reject": reject,
            "serviceOrigin": serviceOrigin
        };
        var tokenUrl = tokenService["@id"] + "?messageId=" + messageId + "&origin=" + getOrigin();
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

// The event listener for postMessage. Needs to take care it only
// responds to messages initiated by openTokenService(..)
// Completes promises made in openTokenService(..)
function receiveMessage(event) {    
    log("event received, origin=" + event.origin);
    log(JSON.stringify(event.data));
    let rejectValue = "postMessage event received but rejected.";
    if(event.data.hasOwnProperty("messageId")){
        log("recieved message with id " + event.data.messageId);
        var message = messages[event.data.messageId];
        if(message && event.origin == message.serviceOrigin)
        {
            // Any message with a messageId is a success
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
        var poll = window.setInterval(() => {
            if(contentProviderWindow.closed){
                log("cookie service window is now closed")
                window.clearInterval(poll);
                resolve();
            }
        }, 500);
    });
}

function sanitise(s, allowHtml){
    // Unimplemented
    // Viewers should already have an HTML sanitiser library, for metadata etc
    if(allowHtml){
        // sanitise but allow permitted tags
        return s;
    }
    // return text content only
    return s;
}

function openContentProviderWindow(service){
    let cookieServiceUrl = service["@id"] + "?origin=" + getOrigin();
    log("Opening content provider window: " + cookieServiceUrl);
    return window.open(cookieServiceUrl);
}

function getContentProviderWindowFromModal(service){
    return new Promise(resolve => {
        hideModals();
        modal = document.getElementById("beforeOpenCookieServiceModal");
        modal.querySelector(".close").onclick = (ev => {
            hideModals();
            resolve(null);
        });
        modal.querySelector("#csConfirm").onclick = (ev => {
            log("Interacting with cookie service in new tab - " + service["@id"]);
            let win = openContentProviderWindow(service);
            hideModals();
            resolve(win);
        });
        modal.querySelector("#csCancel").onclick = (ev => {
            hideModals();
            resolve(null);
        });
        if(service.label){
            modal.querySelector("#csLabel").innerText = sanitise(service.label);
        }
        if(service.header){
            modal.querySelector("#csHeader").innerText = sanitise(service.header);
        }
        if(service.description){
            modal.querySelector("#csDescription").innerText = sanitise(service.description, true);
        }
        if(service.confirmLabel){
            modal.querySelector("#csConfirm").innerText = sanitise(service.confirmLabel);
        }
        modal.style.display = "block";
    });
}

function showOutOfOptionsMessages(service){
    hideModals();
    modal = document.getElementById("failureModal");
    modal.querySelector(".close").onclick = (ev => hideModals());
    modal.querySelector("#failureClose").onclick = (ev => hideModals());
    if(service.failureHeader){
        modal.querySelector("#failureHeader").innerText = sanitise(service.failureHeader);
    }
    if(service.failureDescription){
        modal.querySelector("#failureDescription").innerText = sanitise(service.failureDescription, true);
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

function log(text) {
    var logDiv = document.querySelector("#usermessages");
    var p = document.createElement("p");
    p.innerText = text;
    logDiv.appendChild(p);
    logDiv.scrollTop = logDiv.scrollHeight;
    console.log(text);
}

init();