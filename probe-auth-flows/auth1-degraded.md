# "Degraded" flow

This term is used for scenarios where more than one version of a resource is available depending on a user's permissions. For example, logged-in users get a high quality version, public users get a low quality version. Or one version is watermarked. Or one version has had parts redacted and the other does not. The nature of the difference between versions is irrelevant to the flow, which builds on the concepts introduced in [Basic Login](auth1-basic-login.md).

_Read [part 1](auth1-basic-login.md) first! All the terms are defined there, and the details of each numbered stage are discussed._

## 1. Client wants to show Content Resource

The first part of this flow looks identical to the previous version - the client sees an MP3 that has auth services:

```json
{
    "id": "https://iiif-auth1.herokuapp.com/resources/23_32vs192kbps.mp3",
    "type": "Audio",
    "format": "audio/mp3",
    "duration": 36.0,
    "service": [
        {
            "@id": "https://iiif-auth1.herokuapp.com/auth/cookie/login/23_32vs192kbps.mp3",
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
                    "@id": "https://iiif-auth1.herokuapp.com/auth/token/login/23_32vs192kbps.mp3",
                    "@type": "AuthTokenService1",
                    "profile": "http://iiif.io/api/auth/1/token"
                },
                {
                    "@id": "https://iiif-auth1.herokuapp.com/auth/logout/login/23_32vs192kbps.mp3",
                    "@type": "AuthLogoutService1",
                    "label": "log out",
                    "profile": "http://iiif.io/api/auth/1/logout"
                }
            ]
        },
        {
            "@id": "https://iiif-auth1.herokuapp.com/probe/23_32vs192kbps.mp3",
            "@type": "AuthProbeService1",
            "profile": "http://iiif.io/api/auth/1/probe"
        }
    ]
}
```

## 2. Request the probe service

The client makes a `fetch` or `xhr` request for the probe service:

```
GET /probe/23_32vs192kbps.mp3
Host: iiif-auth1.herokuapp.com
```

The **Server** responds with:

```
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true

{
    "contentLocation": "https://iiif-auth1.herokuapp.com/resources/23_32vs192kbps_degraded.mp3",
    "label": "Probe service for 23_32vs192kbps.mp3"
}
```

> _NB The behaviour of the probe service is different in the draft of IIIF v2 from the example given here. This example mimics the strategy used to probe info.json endpoints to detect redirects and is the version currently implemented in the UV._

Unlike the previous example, the result from the probe is `HTTP 200`. But the `contentLocation` property is **NOT** the URL of the MP3 the client wanted - it's a different URL. The HTTP 200 response tells the client that the user does have access to the supplied URL but did not have access to the MP3 the probe service is for.

## 3. Request the Token Service

Just as before the client can see if it can obtain a token from the token service. Assuming the result is the same as in the first example (a `missingCredentials` error), the client is now sure that the user can't play the MP3 provided by the Manifest.

## Client can play the _degraded_ MP3

It's up to the client what it does with this information. And the client might make different decisions for different types of content. Unlike the previous example, the client knows the user _can_ see something - the resource provided in the `contentLocation`, because that came back with `HTTP 200`.

So the client could start playing this MP3 to the user, while displaying a login call to action using the strings provided in the login service.

Or it could decide to show nothing and offer the user the choice - hear the degraded version, or log in and try to get access to the full version. 

Either way, the client can _offer_ the link to the login service. If the user takes that offer, then the flow resumes as in the first example.

## 4. Open the login service

The client opens the login service in a new tab, and simply waits until that tab closes. It can't do anything else, and has no visibility of what happens in that opened tab. As before, the user is now interacting with the server's login page.

## 5. Try the token service again

As in the previous example the client would now receive a message from the page that has been loaded into the iframe - the page _generated by the **Server**. This message now carries a token:

```json
{
    "messageId": "1236",
    "accessToken": "25928a28d57b33f15147ea23617a5ed7",
    "expiresIn": 3600
}
```

## 6. Try the Probe service again

Now the client can include this token - a _Bearer_ token - in the Probe request, like this:

```
GET /probe/23_32vs192kbps.mp3
Host: iiif-auth1.herokuapp.com
Authorization: Bearer 25928a28d57b33f15147ea23617a5ed7
```

The **Server** might now respond:

```
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true

{
    "contentLocation": "https://iiif-auth1.herokuapp.com/resources/23_32vs192kbps.mp3",
    "label": "Probe service for 23_32vs192kbps_degraded.mp3"
}
```

It's an `HTTP 200` as in the very first step, without the token and before the login. But now the contentLocation matches the MP3 `id` in the manifest - the server is not suggesting an alternative, the `HTTP 200 OK` applies to the MP3 shown in the Manifest.

This means the client knows that the user can see the "full" or advertised version, and not just the alternative provided by the first call to the probe service.

It's again up to the client how it deals with this information. If it wasn't already playing the degraded version it could start playing it.

# Demo

This manifest shows the resource:

https://iiif-auth1.herokuapp.com/manifest/23_32vs192kbps

The difference between the degraded version and the full version is that the degraded version is 32 kbps but the full version is 192 kbps. There is an audible quality difference between them.

If you visit the [Auth 1 demo](https://digirati-co-uk.github.io/iiif-auth-client/?sources=https://iiif-auth1.herokuapp.com/index.json) and select **Degraded flow test for AV - published resource** from the drop down, you can hear the low quality version play immediately. If you follow the generated UI to log in (credentials are already filled for demo), then the client will start playing the "full" version. Other UI treatments of this flow are possible.







