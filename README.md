# iiif-auth-client

This is a client implementation of the [IIIF Authorization Flow specification](http://iiif.io/api/auth/2.0/). It can be used to test individual auth-enabled IIIF Image services:

[https://tomcrane.github.io/iiif-auth-client/?image=https://iiif-auth2-server.herokuapp.com/img/01_Icarus_Breughel.jpg/info.json](https://tomcrane.github.io/iiif-auth-client/?image=https://iiif-auth2-server.herokuapp.com/img/01_Icarus_Breughel.jpg/info.json)

...or it can be given a list of manifests that will populate a drop-down:

[https://tomcrane.github.io/iiif-auth-client/?collection=https://iiif-auth2-server.herokuapp.com/collection.json](https://tomcrane.github.io/iiif-auth-client/?collection=https://iiif-auth2-server.herokuapp.com/collection.json)

> The accompanying server implementation (see below) expects username=username, password=password whenever it presents a login screen.

`iiif-auth-client` is written in ES6 with no dependencies and no transpiling. It is therefore not intended for production use unaltered, but as an example implementation. As ES6 it is easier to understand how the IIIF Auth specification orchestrates the user through one or more interaction patterns, because asynchronous user behaviour and HTTP requests to services can be encapsulated in `async` functions.

The example server implementation:

* Running example: [tomcrane.github.io/iiif-auth-client](https://tomcrane.github.io/iiif-auth-client/?collection=https://iiif-auth2-server.herokuapp.com/collection.json) 
* Source: [iiif-auth-server](https://github.com/tomcrane/iiif-auth-server/tree/auth2-probe-only)





