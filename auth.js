const ACCESS_TYPE = "AuthAccessService2";
const PROBE_TYPE = "AuthProbeService2"; 
const TOKEN_TYPE = "AuthTokenService2";
const MANIFEST_TYPE = "Manifest";

const IMAGE_SERVICE_PROTOCOL = "http://iiif.io/api/image";
const IMAGE_SERVICE_TYPE = 'ImageService2'; // for the purposes of this demo all image services will be given this type if they don't come with a type

const PROFILE_INTERACTIVE = 'interactive';
const PROFILE_KIOSK = 'kiosk';
const PROFILE_EXTERNAL = 'external';
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

    let sourceResource = sourcesMap[resourceId];
    if(!sourceResource){
        log("No resource in sources for resourceId: " + resourceId);
        return;
    }
    if(sourceResource.type === MANIFEST_TYPE && !sourceResource.hasOwnProperty("items")){
        // This is still the reference to the Manifest from the original collection
        fetch(sourceResource.id).then(response => response.json()).then(data => {
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
    loadResource(res);
}


function loadResource(sourceResource){
    let authedResource = constructAuthedResourceInfo(sourceResource)
    authedResourceMap[authedResource.id] = authedResource;
    loadAuthedResource(authedResource.id).then(probedResource => {
        if(probedResource){
            if(probedResource.location || probedResource.status === 401){
                doAuthChain(probedResource).then(() => log("Auth Chain Completed"));
            }
        }
    });
}


function constructAuthedResourceInfo(actualResource){
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

    authedResource.id = actualResource["@id"] || actualResource["id"];
    authedResource.type = actualResource["type"] || actualResource["@type"];
    authedResource.format = actualResource["format"]; // often null
    authedResource.probe = authedResource.id; // unless there's a probe service, below
    authedResource.method = HTTP_METHOD_GET;
    if(authedResource.type.startsWith("ImageService")){
        authedResource.probe = authedResource.id + "/info.json";
        authedResource.imageService = actualResource;
    } else {
        let explicitProbe = first(actualResource["service"], s => s["type"] === PROBE_TYPE);
        if(explicitProbe){
            authedResource.probe = explicitProbe.id;
        } else {
            // The resource is its own probe, but we won't use GET (it might be huge!)
            authedResource.method = HTTP_METHOD_HEAD;
        }
    }
    authedResource.accessServices = asArray(actualResource["service"]).filter(s => s["type"] === ACCESS_TYPE);

    return authedResource;
}


async function loadAuthedResource(authedResourceId, token){
    // token is optional - you might not have it yet!
    let probedAuthResource;
    try{
        probedAuthResource = await getProbeResponse(authedResourceId, token);
    } catch (e) {
        log("Could not load " + authedResourceId);
        log(e);
    }
    if(probedAuthResource && (probedAuthResource.status === 200 || probedAuthResource.location)){
        // we have something to show, even if there's more available after auth
        renderResource(authedResourceId);
    }
    return probedAuthResource;
}

// resolve returns { infoJson, status }
// reject returns an error message
async function getProbeResponse(authedResourceId, token){
    
    // updates the authedResource with information about the user's relationship with the resource,
    // by requesting the probe service (which may be the resource itself).
    
    let authedResource = authedResourceMap[authedResourceId];
    if (!authedResource.accessServices || !authedResource.accessServices.length) {
        // no presence of, or possibility of auth; we don't know if the
        // resource will respond to a HEAD and we don't want to send a token
        // because that imposes CORS reqts on the server that they might 
        // not support because their content is open.
        authedResource.status = 200;
        return authedResource;
    }

    log("Probe will be requested with HTTP " + authedResource.method);

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
    
    authedResource.status = 0;
    authedResource.location = null;

    try
    {
        let response = await fetch(probeRequest);
        authedResource.status = response.status;
        if(authedResource.method === HTTP_METHOD_GET){
            let probeBody = await response.json();
            authedResource.location = probeBody.location;
        }
    } catch (error){
        authedResource.error = error;
    }

    return authedResource; 
}


function renderResource(requestedResourceId){
    destroyViewer();
    const authedResource = authedResourceMap[requestedResourceId];
    if(authedResource.location && authedResource.location !== requestedResourceId){
        log("The requested resource ID is " + requestedResourceId);
        log("The probe offered a location of " + authedResource.location);
        log("This resource is most likely the degraded version of the one you asked for");
    }
    if(authedResource.type === IMAGE_SERVICE_TYPE){
        log("This resource is an image service.");
        if(authedResource.location){
            log("Fetch the info.json for the 'degraded' resource at " + authedResource.location);
            fetch(authedResource.location)
                .then(resp => resp.json())
                .then(json => {
                    if(ensureIsTypedImageService(json))
                    {
                        loadResource(json);
                    }
                });
        } else {
            renderImageService(authedResource);
        }
    } else {
        log("The resource is of type " + authedResource.type);
        log("The resource is of format " + authedResource.format);
        let viewerHTML;
        let isDash = (authedResource.format === "application/dash+xml");
        let resourceUrl = authedResource.location || authedResource.id;
        if(authedResource.type === "Video"){
            viewerHTML = `<video id='html5AV' src='${resourceUrl}' autoplay>Video here</video>`;
        } else if(authedResource.type === "Audio"){
            viewerHTML = `<audio id='html5AV' src='${resourceUrl}' autoplay>audio here</audio>`;
        } else if(authedResource.type === "Text" || authedResource.type === "PhysicalObject"){
            viewerHTML = `<a href='${authedResource.id}' target='_blank'>Open document - ${authedResource.label}</a>`;
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
    makeDownloadLink(authedResource);
}

function makeDownloadLink(authedResource){
    let largeDownload = document.getElementById("largeDownload");
    let w = authedResource.imageService["width"];
    let h = authedResource.imageService["height"]
    let dims = "(" + w + " x " + h + ")";
    let maxWAssertion = first(authedResource.imageService["profile"], pf => pf["maxWidth"]);
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
    let authedResource = authedResourceMap[resourceId];
    log("attempting token interaction for " + authedResource.id);
    let tokenService = first(authService.service, s => s.type === TOKEN_TYPE);
    if(tokenService){
        log("found token service: " + tokenService.id);
        let tokenMessage = await openTokenService(tokenService); 
        if(tokenMessage && tokenMessage.accessToken){
            authedResource = await loadAuthedResource(resourceId, tokenMessage.accessToken);
            log("info request with token resulted in " + authedResource.status);
            if(authedResource.status === 200){
                renderResource(resourceId);
                return true;
            }
        }  
    }
    log("Didn't get a 200 info response.")
    return false;
}

async function doAuthChain(authedResource){
    // This function enters the flowchart at the < External? > junction
    // http://iiif.io/api/auth/1.0/#workflow-from-the-browser-client-perspective
    if(!authedResource.accessServices){
        log("No services found")
        return;
    }
    let lastAttempted = null;

    // repetition of logic is left in these steps for clarity:
    
    log("Looking for external pattern");
    let serviceToTry = first(authedResource.accessServices, s => s.profile === PROFILE_EXTERNAL);
    if(serviceToTry){
        lastAttempted = serviceToTry;
        let success = await attemptResourceWithToken(serviceToTry, authedResource.id);
        if(success) return;
    }

    log("Looking for kiosk pattern");
    serviceToTry = first(authedResource.accessServices, s => s.profile === PROFILE_KIOSK);
    if(serviceToTry){
        lastAttempted = serviceToTry;
        let kioskWindow = openContentProviderWindow(serviceToTry);
        if(kioskWindow){
            await userInteractionWithContentProvider(kioskWindow);
            let success = await attemptResourceWithToken(serviceToTry, authedResource.id);
            if(success) return;
        } else {
            log("Could not open kiosk window");
        }
    }

    log("Looking for interactive pattern");
    serviceToTry = first(authedResource.accessServices, s => s.profile === PROFILE_INTERACTIVE);
    if(serviceToTry){
        lastAttempted = serviceToTry;
        let contentProviderWindow = await getContentProviderWindowFromModal(serviceToTry);
        if(contentProviderWindow){
            await userInteractionWithContentProvider(contentProviderWindow);
            let success = await attemptResourceWithToken(serviceToTry, authedResource.id);
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

// The event listener for postMessage. Needs to take care it only
// responds to messages initiated by openTokenService(..)
// Completes promises made in openTokenService(..)
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

function userInteractionWithContentProvider(contentProviderWindow){
    return new Promise((resolve) => {
        // What happens here is forever a mystery to a client application.
        // It can but wait.
        const poll = window.setInterval(() => {
            if (contentProviderWindow.closed) {
                log("interactive service window is now closed");
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

function openContentProviderWindow(service){
    let interactiveServiceUrl = service.id + "?origin=" + getOrigin();
    log("Opening content provider window: " + interactiveServiceUrl);
    return window.open(interactiveServiceUrl);
}

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
        if(service.header){
            modal.querySelector("#csHeader").innerText = getDisplayText(service.header);
        }
        if(service.description){
            modal.querySelector("#csDescription").innerText = getDisplayText(service.description, true);
        }
        if(service.confirmLabel){
            modal.querySelector("#csConfirm").innerText = getDisplayText(service.confirmLabel);
        }
        modal.style.display = "block";
    });
}

function showOutOfOptionsMessages(service){
    hideModals();
    let modal = document.getElementById("failureModal");
    modal.querySelector(".close").onclick = (ev => hideModals());
    modal.querySelector("#failureClose").onclick = (ev => hideModals());
    if(service.failureHeader){
        modal.querySelector("#failureHeader").innerText = getDisplayText(service.failureHeader);
    }
    if(service.failureDescription){
        modal.querySelector("#failureDescription").innerText = getDisplayText(service.failureDescription, true);
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

function log(text) {
    const logDiv = document.querySelector("#usermessages");
    const p = document.createElement("p");
    p.innerText = text;
    logDiv.appendChild(p);
    logDiv.scrollTop = logDiv.scrollHeight;
    console.log(text);
}

init();