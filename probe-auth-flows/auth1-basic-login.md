# Probe flow, basic login

In the following, _Client_ means a JavaScript viewer implementing the IIIF Auth API. For example, the UV. And _Server_ means the back-end that is serving the resources.

This flow is based on the existing IIIF Auth Spec, [version 1](https://iiif.io/api/auth/1.0/), and the [discussions about a probe service on GitHub](https://github.com/IIIF/api/issues/1290). It's recommended to read through to the end of that thread as the discussion goes in various directions.

This [Slide Deck from 2020](https://docs.google.com/presentation/d/1KBFYK0pz-NPqY5BTeP97XHUrMKYEeg53S1_9Uq9Ylxc/edit) gives an introduction to IIIF Auth.

**The Probe Service is still exactly the same flow as existing [IIIF Auth](https://iiif.io/api/auth/1.0/) for images, that clients like the UV have supported for years - there's a login service, and a token service that opens in an iframe, and a postMessage call from the iframe to the client. The only difference is that for image services, the info.json _is_ the probe service, but for AV resources (or any other resources) we have to supply a separate endpoint to act as the probe.** 

**EVERY OTHER PART OF THE FLOW IS THE SAME, and can use the same code.** (See Note 1)

## Key Points

- The IIIF Auth Specification is not itself an auth protocol like OAuth. 
- Its purpose is to provide an interchange of information so that an untrusted client (like the UV) can learn whether the user has permission to see (or hear) a resource, before attempting to present the resource to the user.
- It exists to enable a **good user experience** in standalone clients, NOT to provide access control.
- Access control is up to you.
- You might not need IIIF Auth in a controlled web environment where you know what a user can see before you present them with a viewer.

_On with the flow..._

## 1. Client wants to show Content Resource

Usually, when the client comes across a resource to show or play, it just does it. A IIIF Manifest from the **Server** might include this MP3:

```json
{
    "id": "https://iiif-auth1.herokuapp.com/resources/22a_sample-3s.mp3",
    "type": "Audio",
    "format": "audio/mp3",
    "duration": 3.0
}
```

This scenario doesn't interest us! The client should just play this MP3.

> Note that the URL patterns seen in this demo don't mean anything, they are just implementation details of the demo. You can structure your URLs however you like. A client shouldn't infer anything from URL patterns.

When the client sees a resource **with IIIF Auth services**, it knows it needs to do more work. The **Server** added some extra info into the published Manifest:

```json
{
    "id": "https://iiif-auth1.herokuapp.com/resources/22a_sample-3s.mp3",
    "type": "Audio",
    "format": "audio/mp3",
    "duration": 3.0,
    "service": [
        {
            "@id": "https://iiif-auth1.herokuapp.com/auth/cookie/login/22a_sample-3s.mp3",  // This is the login page, that the
            "@type": "AuthCookieService1",                                                  // client can open in a new tab
            
            // These properties provide text for the client to make a UI 
            "confirmLabel": "Login",
            "description": "Example Institution requires that you log in with your example account to view this content.",
            "failureDescription": "<a href=\"http://example.org/policy\">Access Policy</a>",
            "failureHeader": "Authentication Failed",
            "header": "Please Log In",
            "label": "Login to Example Institution",
            
            "profile": "http://iiif.io/api/auth/1/login",   // This tells us that it's the login interaction pattern
            
            "service": [
                {
                    "@id": "https://iiif-auth1.herokuapp.com/auth/token/login/22a_sample-3s.mp3",  // The token service
                    "@type": "AuthTokenService1",                                                  // that the client loads in   
                    "profile": "http://iiif.io/api/auth/1/token"                                   // an iframe  
                },
                {
                    "@id": "https://iiif-auth1.herokuapp.com/auth/logout/login/22a_sample-3s.mp3", // This is the logout page
                    "@type": "AuthLogoutService1",
                    "label": "log out",
                    "profile": "http://iiif.io/api/auth/1/logout"
                }
            ]
        },
        {
            "@id": "https://iiif-auth1.herokuapp.com/probe/22a_sample-3s.mp3",  // This is the probe service that the client 
            "@type": "AuthProbeService1",                                       // requests to learn about the user's access  
            "profile": "http://iiif.io/api/auth/1/probe"                        // to the resource
        }
    ]
}
```

This is the same MP3 file, but now it has **IIIF Auth** attached to it.

The client doesn't yet know if the user has the credentials they need to play that MP3 successfully. So the client doesn't want to just let them play it - it might break. If the client (for example) creates an `<audio>` tag and sets that MP3 to its `src` attribute, the **Server** will respond to the browser's MP3 request with an `HTTP 401 UNAUTHORISED` status code, and the MP3 won't play.

But the client can see that this MP3 resource, in the JSON, has:

 - An `AuthCookieService1` with a profile of `http://iiif.io/api/auth/1/login`, indicating that there's a login page the client can open for the user if it needs to. The `@id` of this service is the address of the login page - a normal web page presenting a login form (typically).
 - An `AuthProbeService1` that the client can request to test whether the user has access.

The `AuthCookieService1` has some strings (e.g., `description`) that the client can use to build some UI.

The `AuthCookieService1` itself has two child services, an `AuthTokenService1` and an `AuthLogoutService1`. The latter is easy to understand - just as the login page offers a login form of some sort, the logout service is the page a user would go if they want to log out. But what's the Token service and what's the Probe service?

The client obtains a token from the token service, and includes it when it requests the probe service. The token represents the user's access, without itself being a credential.

Clients can store tokens to optimise the workflow, and they can use the token and probe services _preemptively_ to check a user's access, in case they don't need to log in. There is flexibility in the flow the client follows; the flow presented here is trying to minimise unnecessary user interations but is not the only possible flow. A less sophisticated client might make the user visit the login page for every view, even when they are already logged in.


## 2. Request the probe service

The probe service is what tells the client whether the user can see the resource.

> In practice, a client seeing this MP3 for the first time would probably skip this initial probe request as it's very likely to give a negative answer, even if the user does have access, because the client hasn't yet interacted with the token service: it's just going to request the probe service without any additional parameters. We've included it here for completeness because if a client implements the same flow for info.json resources, it **has** to request the info.json first anyway - and the info.json is its own probe.

The client makes a `fetch` or `xhr` request for the probe service:

```
GET /probe/22a_sample-3s.mp3
Host: iiif-auth1.herokuapp.com
```

_(typical HTTP requests and responses will have more headers than the examples here; we've only included relevant ones)_

The **Server** responds with:

```
HTTP/1.1 401 UNAUTHORIZED
Content-Type: application/json
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true

{
    "contentLocation": "https://iiif-auth1.herokuapp.com/resources/22a_sample-3s.mp3",
    "label": "Probe service for 22a_sample-3s.mp3"
}
```

That `contentLocation` property is the same URL for the MP3 as advertised in the Manifest. And the HTTP status code was a 401.
(See Note 2 about contentLocation)

This response tells the client that the user does not have permission to see this MP3.

However, the client didn't present any "evidence" to the probe service. If you paste the [URL of the probe service](https://iiif-auth1.herokuapp.com/probe/22a_sample-3s.mp3) into a browser, then the request will include any cookies that you might have for the domain. But the untrusted JavaScript client can't make a request like that; no cookies were sent with that request, even if the user had one. The client uses `fetch` or `XmlHttpRequest` (`xhr`), which is subject to restrictions that aren't present for a normal request, or when an `<audio />` tag just requests the MP3 directly.  

So the client needs to make a request to the **Server** that acts like a normal, unrestricted request for the MP3, but from which the client can get some information. This is the purpose of the **Token service**. The client does **NOT** make a `fetch` or `xhr` request for the token service, but instead creates an `<iframe>` and sets the `src` of this iframe to the [token service URL](https://iiif-auth1.herokuapp.com/auth/token/login/22a_sample-3s.mp3). When the browser then makes the request for the iframe contents, it will do so as a normal request, which means cookies will be sent.

> It's up to the client whether it creates an iframe each time, or keeps one around and resuses it. Either way, the client should hide the iframe from the user.

## 3. Request the Token Service

Before requesting the token service, the client must do some initial setup. It expects to receive messages from the web page (i.e., the token service) that loads into the iframe from the **Server**. So it needs to register a _listener_. Typically a client only does this once, there's no need to do it on every message:

```javascript
window.addEventListener("message", receiveMessage);

function receiveMessage(event) {
    data = event.data;
    var token, error;
    if (data.hasOwnProperty('accessToken')) {
        token = data.accessToken;
    } else {
        // handle error condition
    }
    // take the token and send it against the probe service
}
```

And typically a client might only create one iframe for messaging purposes and keep it around. More complex clients might be making multiple asynchronous token requests, but we'll assume the simple case:

```html
<iframe id="messageFrame"></iframe>
```

Once this has been set up, whenever the client "calls" a token service, it does so by setting this iframe src to the token service, with two additional query parameters:

```javascript
function callTokenService(tokenService, messageId, origin){
    document.getElementById('messageFrame').src = tokenService + "?messageId=" + messageId + "&origin=" + origin;
}

// if called literally, which is unlikely:
callTokenService("https://iiif-auth1.herokuapp.com/auth/token/login/22a_sample-3s.mp3", 1234, "https://client.example.com/");

// a more typical call:
let messageId = getNextMessageId();
callTokenService(tokenService["@id"], messageId, window.location.origin);
// use messageId to match this call to the message recieved in receiveMessage(..)
```

The `messageId` parameter is for use by the client, to match requests and responses. The `origin` parameter is the `targetOrigin` parameter as described by the [postMessage API specification](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage). 

The **Server** must generate a token service response. This response is not simple JSON - it's a **web page** that will be loaded in the iframe. This web page isn't for the user to look at - it only exists to send a message to the client. But crucially, the **Server** sees the token request as a normal web request, not a `fetch` request. Any cookies the user's browser might send when requesting the MP3 itself will also be sent to the token service. In our current case, the user hasn't logged in yet, so the token service response from the **Server** is a web page like this (the token response status is always HTTP 200):

```html
<html>
<body>
<script>    
    window.parent.postMessage(
        {
            "error": "missingCredentials",          // This is the message
            "description": "User not logged in!",   // body as defined in the 
            "messageId": "1234"                     // postMessage API spec
        },
        "https://client.example.com/"               // This is the postMessage targetOrigin;                                               
    );                                              // It restricts where the message is sent
</script>
</body>
</html>
```

The client receives this message body in the event listener it registered earlier:

```json
{
    "error": "missingCredentials",
    "description": "User not logged in!",
    "messageId": "1234"
}
```

The client uses the `messageId` to match up received messages. The request for the token (by setting iframe src) and the eventual response (receiving a postMessage) is highly asynchronous, and complex clients might make multiple requests; the messageId allows the client to connect requests and received messages.

In this case, the message was an error state: the client now knows that the user does not have the credentials required to see the resource. The form of this error message, and the form of a success message, are defined by the IIIF Auth specification. **The token service must render a web page with script that sends a postMessage**; it shouldn't be doing anything else.

Now the client knows that the user really doesn't have access to the resource. So the client gets the user to log in.

## 4. Open the login service

The client opens the login service in a new tab, and simply waits until that tab closes. It can't do anything else, and has no visibility of what happens in that opened tab.

The **Server** responds with whatever login UI is appropriate. It might be a simple login form, that sets a cookie on success, or it might redirect to a single sign on provider, perhaps using OAuth2, that eventually after several bounces across domains arrives back on the same domain as the content resources and sets a cookie. Whatever it does, it's invisible and irrelevant to the client. Whatever happens, when the user has finished interacting, the window must close. This close might happen because the **Server** has emitted a web page that includes a JavaScript `window.close()`, or the user might manually close the window.

## 5. Try the token service again

Once the **Server** window for the login service has closed, control of the flow resumes in the client.

The client asks for the token service again:

```javascript
// for example
callTokenService(tokenServiceUrl, messageId, myOrigin);
```

The iframe src is set to the token service. The **Server** can see the valid cookie that the user just acquired when they logged in, so it responds with an Access Token that _represents_ this cookie:

```html
<html>
<body>
<!-- 
    THIS PAGE IS SERVED BY THE SERVER! 
    The iframe it's in is part of the client, but
    the page itself is not generated by the client.
-->
<script>    
    window.parent.postMessage(
      {
        "messageId": "1235",
        "accessToken": "6ddab48ba47ff92c3f9a44aa8ed02e8f",
        "expiresIn": 3600
      },
      'https://client.example.com/'
    );    
</script>
</body>
</html>
```

The Token is _evidence_ - it acts as a proxy for whatever real credential the user has been allocated at login (typically a cookie). The token request was made without the constraints of a `fetch` request - in fact it was made with the same constraints as a typical _content resource_ request, but the client acquired some JSON information from it, rather than the MP3 itself.

The client still doesn't know if the user can see the MP3 though. The client knows the client has some sort of credential, and now the client has a token that represents this credential, but it needs to check this token against the probe service. Typically a client will store the token for a while, observing its time-to-live (the `expiresIn` property), to avoid repeated requests to the token service. 

## 6. Try the Probe service again

Now the client can include the token - a _Bearer_ token - in the Probe request, like this:

```
GET /probe/22a_sample-3s.mp3
Host: iiif-auth1.herokuapp.com
Authorization: Bearer 6ddab48ba47ff92c3f9a44aa8ed02e8f
```

The **Server** might now respond:

```
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true

{
    "contentLocation": "https://iiif-auth1.herokuapp.com/resources/22a_sample-3s.mp3",
    "label": "Probe service for 22a_sample-3s.mp3"
}
```

The token does not give access to the resource itself - if the client sent this token to the MP3 URL, it would be a 401. And the server shouldn't use the same string for the bearer token as it uses for the real credential, because a malicious client could guess what the real cookie looks like. A typical **Server** might keep a lookup of sessions to tokens, so that when it sees the cookie accompanying a token request it can mint/return a token; when the probe service is called with the token, the **Server** can look up the token to see if the user has an active session. This is out of the scope of the Auth API and allows for many different implementation approaches. The IIIF exchange offers a window into whatever auth process the **Server** implements, revealing just enough information via the probe and token services for the client to understand what the user can see. A token can be any string, it doesn't have to look like the example here.

Because the server responded with an `HTTP 200` to the probe request, when the request was made using the token from the token service, the client knows that the user has credentials for the actual resource (the MP3). The _Bearer token_ acted as a proxy for whatever credential the user has (typically a cookie), but the bearer token on its own has no use outside this exchange.

Now the client can let the user play the MP3, and the auth flow has done its job.

It's very likely that if the user is exploring content from the same source, many resources will have the same login and token services. A library doesn't have a separate login page for each resource! And very likely the cookie obtained by logging in grants access to many resources. So the client need not open the login service if it knows it has an active token.

However the client should be prepared for failure. It should always call the probe service for a resource before showing it, with the relevant token. If that probe service returns a 401, the client should try to reacquire a token from the token service. And if that fails too, then offer the login page again, in a new tab. Many flows are possible and the specification does not enforce one unalterable flow - but the elements of the flow must work as described here.


-----

## Note 1

The UV's existing auth flow should be doing most of the work already - managing the iframe, postmessage, etc.

The only difference is the probe service; whereas for image services it uses the HTTP status code of the info.json, here it must use the HTTP status of the probe service.
For degraded access in the Auth 1 spec, for image services, the difference in IDs


## Note 2

I've kept the same behaviour for contentLocation as the older POCs for auth/probe, where this is simulating what the info.json ID would do.
To me the `location` property and its behaviour introduced in the new Auth spec make more sense.


----


Experiments:

https://digirati-co-uk.github.io/iiif-auth-client/?sources=https://iiif-auth1.herokuapp.com/index.json