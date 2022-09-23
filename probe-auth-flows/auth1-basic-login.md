# Probe flow, basic login

In the following, _Client_ means a JavaScript viewer implementing the IIIF Auth API. For example, the UV. And _Server_ means the back-end that is serving the resources.

This flow is based on the existing IIIF Auth Spec, [version 1](https://iiif.io/api/auth/1.0/), and the [discussions about a probe service on GitHub](https://github.com/IIIF/api/issues/1290). It's recommended to read through to the end of that thread as the discussion goes in various directions.

This [Slide Deck from 2020](https://docs.google.com/presentation/d/1KBFYK0pz-NPqY5BTeP97XHUrMKYEeg53S1_9Uq9Ylxc/edit) gives an introduction to IIIF Auth.

**The Probe Service is still exactly the same flow as regular auth for images, that clients like the UV have supported for years - there's a login service, and a token service that opens in an iframe. The only difference is that for image services, the info.json _is_ the probe service, but for AV resources (or any other resources) we have to supply a spearate endpoint to act as the probe. EVERY OTHER PART OF THE FLOW IS THE SAME.** (See Note 1)

> The most important thing to remember is that the IIIF Auth Specification is not itself an auth protocol like OAuth. Its purpose is to provide an interchange of information so that an untrusted client (like the UV) can learn whether the user has permission to see (or hear) a resource, before attempting to present the resource to the user. In other words, to avoid a poor user experience when the user experience is out of the hands of the content publisher. And then, if the client learns that the user can't see the resource, the spec provides the client with a link (typically a login page) where the user might acquire that permission (typically a cookie). The client can allow the user to click on the link, wait for the user to return from that login page, then try the auth flow again.

## 1. Client sees Content Resource

Usually, when the client comes across a resource to play, it just plays it. A IIIF Manifest from the **Server** might include this MP3:

```json
{
    "id": "https://iiif-auth1.herokuapp.com/resources/22a_sample-3s.mp3",
    "type": "Audio",
    "format": "audio/mp3",
    "duration": 3.0
}
```

This scenario doesn't interest us!

However, when the client sees a resource **with Auth services**, it knows it needs to do more work. The **Server** added some extra info:

```json
{
    "id": "https://iiif-auth1.herokuapp.com/resources/22a_sample-3s.mp3",
    "type": "Audio",
    "format": "audio/mp3",
    "duration": 3.0,
    "service": [
        {
            "@id": "https://iiif-auth1.herokuapp.com/auth/cookie/login/22a_sample-3s.mp3",  // This is the login page
            "@type": "AuthCookieService1",
            "confirmLabel": "Login",
            "description": "Example Institution requires that you log in with your example account to view this content.",
            "failureDescription": "<a href=\"http://example.org/policy\">Access Policy</a>",
            "failureHeader": "Authentication Failed",
            "header": "Please Log In",
            "label": "Login to Example Institution",
            "profile": "http://iiif.io/api/auth/1/login",
            "service": [
                {
                    "@id": "https://iiif-auth1.herokuapp.com/auth/token/login/22a_sample-3s.mp3",
                    "@type": "AuthTokenService1",
                    "profile": "http://iiif.io/api/auth/1/token"
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
            "@id": "https://iiif-auth1.herokuapp.com/probe/22a_sample-3s.mp3",
            "@type": "AuthProbeService1",
            "profile": "http://iiif.io/api/auth/1/probe"
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

The `AuthCookieService1` itself has two child services, an `AuthTokenService1` and an `AuthLogoutService1`. The latter is easy to understand - just as the login page offers a login form of some sort, the logout service is where a user would go if they want to log out. But what's the Token service and what's the Probe service?

In theory a client doesn't have to maintain any state, and can guide the user through the login process every time they want to play a resource. In practice, clients like the UV store information so they don't make unnecessary requests. Assuming the client has no stored information about the user's relationship with this resource, it could do the following:

## 2. Request the probe service

The probe service is what tells the client whether the user can see the resource.

> In practice, a client seeing this MP3 for the first time would probably skip this initial probe request as it's very likely to give a negative answer, even if the user does have access, because the client hasn't yet interacted with the token service. We've included it here for completeness because if a client implements the same flow for info.json resources, it has to request the info.json first anyway - and the info.json is its own probe.

The client makes a `fetch` or `xhr` request for the probe service:

```
GET /probe/22a_sample-3s.mp3
Host: iiif-auth1.herokuapp.com
```

_(typical HTTP requests and responses will have more headers than the examples here; we've only included relevant ones)_

The **Server** will respond with:

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

However, the client hasn't presented any "evidence" to the probe service. If you paste the URL of the probe service into a browser, then the request will include any cookies that you might have for the domain. But the untrusted client can't make a request like that; it has to use `fetch` or `XmlHttpRequest` (`xhr`), which is subject to restrictions that aren't present for a normal request, or when an `<audio />` tag just requests the MP3 directly.  

So the client needs to make a request to the **Server** that acts like a normal, unrestricted request, but from which the client can get some information. This is the purpose of the token service. The client does **NOT** make a `fetch` or `xhr` request for the token service, but instead creates an `<iframe>` and sets the `src` of this iframe to the token service. When the browser then makes the request for the iframe contents, it will do so as a normal request, which means cookies will be sent.

> It's up to the client whether it creates an iframe each time, or keeps one around and resuses it. Either way, the client should hide the iframe from the user.

## 3. Request the Token Service

Before requesting the token service, the client must do some setup. It expects to receive messages from the web page (i.e., the token service) that it loads into the iframe. So it needs to register a listener. Typically a client only does this once, no need to do it on every message:

```javascript
window.addEventListener("message", receive_message);

function receive_message(event) {
    data = event.data;
    var token, error;
    if (data.hasOwnProperty('accessToken')) {
        token = data.accessToken;
    } else {
        // handle error condition
    }
    // ...
}
```

```html
<iframe id="messageFrame"></iframe>
```

Once this has been set up, the client sets the iframe src to the token service, with two additional query parameters:

```javascript
document.getElementById('messageFrame').src =
  'https://iiif-auth1.herokuapp.com/auth/token/login/22a_sample-3s.mp3?messageId=1234&origin=https://client.example.com/';
```

The `messageId` parameter is for use by the client, to match requests and responses. The `origin` parameter the same `origin` parameter as described by the [postMessage API specification](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

The **Server** must generate a token service response. This response is not simple JSON - it's a web page that will be loaded by the iframe. This web page isn't for the user to look at - it only exists to send a message to the client. But crucially, the **Server** sees the token request as a normal web request, not a `fetch` request. It can see the cookies that the browser sends. 

Any cookies the user's browser might send when requesting the MP3 itself will also be sent to the token service. In our current case, the user hasn't logged in yet, so the token service response from the **Server** is a web page like this (the token response status is always HTTP 200):

```html
<html>
<body>
<script>    
    window.parent.postMessage(
      {"error": "missingCredentials", "description": "to be filled out", "messageId": "1234"},
      "https://client.example.com/"
    );    
</script>
</body>
</html>
```

The client receives this message body in the event listener it registered earlier:

```json
{
    "error": "missingCredentials",
    "description": "to be filled out",
    "messageId": "1234"
}
```

The client uses the messageId to match up received messages. The request for the token (by setting iframe src) and the eventual response (receiving a postMessage) is highly asynchronous, and complex clients might make multiple requests; the messageId allows the client to connect requests and received messages.

In this case, the message was an error: the client now knows that the user does not have the credentials required to see the resource. The form of this error message, and the form of a success message, are defined by the IIIF Auth specification. The token service must render script that sends a postMessage; it can't do anything else.

This token service was the token service for a login service for the resource... so the client should next get the user to interact with the login service.

## 4. Open the login service

The client opens the login service in a new tab, and simply waits until that tab closes. It can't do anything else, and has no visibility of what happens in that opened tab.

The **Server** responds with whatever login UI is appropriate. It might be a simple login form, that sets a cookie on success, or it might redirect to a single sign on provider, perhaps using OAuth2, that eventually after several bounces across domains arrives back on the same domain as the content resources and sets a cookie. Whatever it does, it's invisible and irrelevant to the client. Whatever happens, when the user has finished interacting, the window must close. This close might happen because the **Server** has emitted a web page that includes a JavaScript `window.close()`, or the user might manually close the window.

## 5. Try the token service again

Once the **Server** window for the login service has closed, control of the flow resumes in the client.

The client asks for the token service again:

```javascript
document.getElementById('messageFrame').src =
  'https://iiif-auth1.herokuapp.com/auth/token/login/22a_sample-3s.mp3?messageId=1235&origin=https://client.example.com/';
```

And the **Server**, now that it can see the valid cookie that the user just acquired, will respond with an Access Token:


```html
<html>
<body>
<script>    
    window.parent.postMessage(
      {
        "messageId": "1235",
        "accessToken": "TOKEN_HERE",
        "expiresIn": 3600
      },
      'https://client.example.com/'
    );    
</script>
</body>
</html>
```

The Token is _evidence_ - it acts as a proxy for whatever real credential the user has for the resource. The token request was made without the constraints of a `fetch` request - in fact it was made with the same constraints as a typical _content resource_ request, but the client still acquired some JSON information from it.

The client still doesn't know if the user can see the resource though - it needs to check this token against the probe service. Typically a client will hang on to the token, observing its time-to-live (the `expiresIn` property). It can test access by sending it to the Probe service.

## 6. Try the Probe service again

Now the client can include the token - a _Bearer_ token - in the Probe request, like this:


```
GET /probe/22a_sample-3s.mp3
Host: iiif-auth1.herokuapp.com
Authorization: Bearer TOKEN_HERE
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

The token does not give access to the resource itself - if the client sent this request to the MP3 URL, it would be a 401. And the server shouldn't use the same string for the bearer token as it uses for the real credential, because a malicious client could guess what the real cookie looks like. A typical **Server** might keep a lookup of sessions to tokens, so that when it sees the cookie accompanying a token request it can mint/return a token; when the probe service is called with the token, the **Server** can look up the token to see if the user has an active session. This is out of the scope of the Auth API and allows for many different implementation approaches. The IIIF exchange offers a window into whatever auth process the **Server** implements, revealing just enough information via the probe and token services for the client to understand what the user can see.

Because the server responded with a 200 to the probe request, when the request was made using the token from the token service, the client knows that the user has credentials for the actual resource (the MP3). The _Bearer token_ acts as a proxy for whatever credential the user has (typically a cookie), but the bearer token on its own has no use outside this exchange.

Now the client can let the user play the MP3.

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