# Probe flow, basic login

In the following, _Client_ means a JavaScript viewer implementing the IIIF Auth API. For example, the UV. And _Server_ means the back end that is serving the resources *and* providing the server part of the Auth spec.

This flow is based on the existing IIIF Auth Spec, [version 1](https://iiif.io/api/auth/1.0/), and the [discussions about a probe service on GitHub](https://github.com/IIIF/api/issues/1290). It's recommended to read through to the end of that thread as the discussion goes in various directions.

This [Slide Deck from 2020](https://docs.google.com/presentation/d/1KBFYK0pz-NPqY5BTeP97XHUrMKYEeg53S1_9Uq9Ylxc/edit) gives an introduction to IIIF Auth.

The most important thing to remember is that the IIIF Auth Specification is not itself an auth protocol like OAuth. Its purpose is to provide an interchange of information so that an untrusted client (like the UV) can learn whether the user has permission to see (or hear) a resource, before attempting to present the resource to the user. In other words, to avoid a poor user experience when the user experience is out of the hands of the content publisher. And then, if the client learns that the user can't see the resource, the spec provides the client with a link (typically a login page) where the user might acquire that permission (typically a cookie). The client can allow the user to click on the link, wait for the user to return from that login page, then try the auth flow again.

## 1. Client loads IIIF Manifest

The manifest might have many resources (e.g., many MP3s) and it would be common that once a user has acquired a cookie that lets them see one of the resources, they can probably see all of them. This means that a client can optimise the user experience and not 
