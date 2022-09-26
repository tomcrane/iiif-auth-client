# Server Responsibilities

## Do you need IIIF Auth?

Before implementing IIIF Auth, it's worth considering whether you need it. IIIF Auth is specifically for interoperability: for when your IIIF Manifests are loaded into an environment you have no control over, and when that environment has no knowledge in advance of whether you have any access control on your resources, and certainly no idea how a user might negotiate it. That knowledge is baked into the embedded viewer (e.g., the UV).

Having an implementation of IIIF Auth in the UV and other clients allows people to view and work on access controlled content from _multiple_ publishers because the interaction with access control is encapsulated in the client tool embedded on a web page; the wider web application doesn't need to understand what is happening, or how BL, Wellcome, Harvard, Stanford, etc., implement their own publisher-specific access control. You can stick the UV in a blog post and it will do the hard work.

The Save our Sounds web site could lean entirely on the UV and this _prototype, proof of concept_ probe authentication implementation. But if the web page is aware of the user's access status for the AV resources on a page, it can decide whether to render the UV (or any other player), and if so, it can also decide which resource to load into the UV (what manifest to reference).  The Save our Sounds site is from the same publisher as the linked resources; any access control is on the same domain as the site (*.bl.uk). If the UV was only given what the containing web page knows the current user already has access to, then access control interations aren't something the UV needs to drive.

The British Library has a commitment to making its resources available via IIIF; its contributions to the IIIF AV working group were a key driver for version 3 of the IIIF Presentation API, which allows time-based media from Save our Sounds and other collections to be published as interoperable open standards. But this includes the _access-controlled_ Save our Sounds material. And while the IIIF Manifests for Save our Sounds can use the IIIF Presentation API (thanks in no small part to the BL's contributions to specification work), and image-service based material can combine the Presentation API with IIIF Auth v1, the Save our Sounds material can't yet use a released Auth specification that goes beyond IIIF Image Services, because that specification doesn't exist. So the interoperability requirement for access-controlled AV content can't be met immediately - there are no clients compatible with a released specification. If BL releases IIIF Manifests for Save our Sounds that reference access controlled content, it's likely that the probe approach will be similar 

Work on the required enhancements to the IIIF Auth API for a version 2 stalled somewhat after that initial probe experiment with the BL, but has recently picked up again. A good summary is in the minutes of this [IIIF Auth Technical Specification Group meeting](https://docs.google.com/document/d/1jfaJgxbOb56-d09NGZ9RT20oWuqjfdv7EPRdsJf6idE/edit#heading=h.9asov5tjqla) from August. A draft of the new specification is available. This is similar to the current UV implementation and expected BL back-end, but not identical. 


## Access Control

Assuming that IIIF Auth is required, or rather the probe prototype as an extension of Auth 1 is required, then the two previous walkthroughs imply services and functionality that the **Server** must implement.

[Basic flow](https://github.com/tomcrane/iiif-auth-client/blob/iiif-auth2/probe-auth-flows/auth1-basic-login.md)

["Degraded" flow](https://github.com/tomcrane/iiif-auth-client/blob/iiif-auth2/probe-auth-flows/auth1-degraded.md)

The main thing you need to implement is some form of Access Control to protect the AV resources. The specification doesn't define how you do this, although there is an assumption in IIIF Auth v1 that access control is based on cookies: a request for the MP3 with no cookie will get a 401 response, OR be redirected to an alternate, part-redacted version (depending on how restricted the content is, and corresponding to the two scenarios mentioned above). If the user logs in and acquires a cookie, then they get the full MP3. This can be tested and should work completely independently of IIIF - direct requests to the MP3, or simple pages playing the MP3 in an `<audio />` tag, just work - because the user has the cookie. It's no more complex than that.


## Login page

You need to provide a login page, where the user can acquire that cookie.

From the current BL Manifests, this login page is https://apiirc.ad.bl.uk/auth/iiif/login.

The only thing required of this to make it compatible with the IIIF Auth specification is that once the user interaction has finished, whether the user logged in or not, the window must close itself, with a `window.close()` JavaScript call. If the same login page is used by other user flows, and not just the IIIF Auth flow, then the `@id` of this service in the IIIF Manifest should include something that the page can use to identify it as being opened by a IIIF Client, e.g., `https://apiirc.ad.bl.uk/auth/iiif/login?from=iiif` (or anything else).

The **Server** can also provide a logout page, but this is optional.

## The Token Service

> Defined in IIIF Auth Specification - [2.2. Access Token Service](https://iiif.io/api/auth/1.0/#access-token-service)

This is an endpoint that MUST be able to see the same cookie(s) that the **Server** uses to determine access. So it must be on the same domain, and if the cookies are restricted by path, it must be on the same path. There might be just one token service, or different token services for different sets of content (because they need different cookies), or even one token service per protected resource, wlhough this is unlikely.

The token service takes two query string parameters, `messageId` and `origin`, defined in [Interaction for Browser-Based Client Applications](https://iiif.io/api/auth/1.0/#interaction-for-browser-based-client-applications)

The token service renders a very simple web page, that includes some script that calls `window.postMessage`. The message sent is information about the cookie credentials the token service sees in the request from the client. It will either be an error condition, if there are invalid or missing cookies, or it will be an _access token_.

For example, no cookie:

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
        "https://save-our-sounds.bl.uk/"            // This is the postMessage targetOrigin;                                               
    );                                              // It restricts where the message is sent
</script>
</body>
</html>
```

The error conditions are defined in [2.2.6. Access Token Error Conditions](https://iiif.io/api/auth/1.0/#access-token-error-conditions).

If the token service recognises the cookie(s) as valid, unexpired credentials, it creates or retrieves a _token_ that represents that cookie. It shouldn't _be_ the cookie: it's a proxy for the cookie. A typical server implementation might store a table of session keys and tokens. From the cookie it might look up the session key and retrieve or mint a token. The implementation is up to the **Server**.

```html
<html>
<body>
<script>    
    window.parent.postMessage(
      {
        "messageId": "1234",           // the messageId, echoed back
        "accessToken": "6ddab48ba47ff92c3f9a44aa8ed02e8f",
        "expiresIn": 3600
      },
      "https://save-our-sounds.bl.uk/" // the origin, echoed back
    );    
</script>
</body>
</html>
```

The token service echoes back the messageId and origin parameters. It doesn't need to store the messageId, this is for the client's use, to match up multiple calls to the service. The server could validate the origin, however, if it wishes to reject anything other than clients from the BL domain. A client can fake its origin, but that means it won't receive the `postMessage` message. The **Server** should not emit `"*"` for the origin (meaning any listener can receive the message).

The token service doesn't specifically tell the client that the user can see a particular resource. The token service is associated with an access cookie service (the login page) and returns tokens that correspond to the cookies issued by that cookie service. To verify that the user does indeed have a cookie that gives them access to a particular resource, the client needs to send the token to the probe service:

## The Probe Service

> Not defined in any specification, yet, but see the two walkthroughs

While the token service is associated with an access cookie service, and represents with a token the credentials acquired from that service, the probe service is associated with a resource. 

The probe service doesn't expect to see the cookie(s) a user might have acquired - usually, they won't be sent. The probe service could even be on a different domain. The probe service looks for a request header that contains a token - the _Bearer_ token. For example it would extract the token `6ddab48ba47ff92c3f9a44aa8ed02e8f` from this request:

```
GET /probe/22a_sample-3s.mp3
Host: iiif-auth1.herokuapp.com
Authorization: Bearer 6ddab48ba47ff92c3f9a44aa8ed02e8f
```

The probe service needs to answer the question "does the credential _represented by_ this token give the user access to this resource?"

If **yes**, the probe service responds with `HTTP 200 OK` and a JSON body containing a `contentLocation` property that matches the resource the probe service was requested for:

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

If **no**, the probe service responds with `HTTP 401 UNAUTHORIZED`, and the message body is the same:

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

If **no** _but the user can see an alternative version_ the probe service responds with `HTTP 200 OK` and the alternative version as the `contentLocation`:

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

This is the probe service saying "the credentials represented by the supplied token can't see the resource the probe service was declared for, but they can see this resource". Usually the alternative resource is degraded or redacted in some way.


