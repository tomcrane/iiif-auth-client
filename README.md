# iiif-auth-client

This is a client implementation of the [IIIF Authorization Flow specification](http://iiif.io/api/auth/2.0/). It can be used to test individual auth-enabled IIIF Image services:

`https://tomcrane.github.io/iiif-auth-client/?image=<server>/img/01_Icarus_Breughel.jpg/info.json`

...or it can be given a list of manifests that will populate a drop-down:

`https://tomcrane.github.io/iiif-auth-client/?collection=<server>/collection.json`

...or a single manifest, with `?manifest=<manifest url>`.

The home page of the [accompanying server](https://github.com/tomcrane/iiif-auth-server) links to the client with its collection already filled in.

> The accompanying server implementation expects username=username, password=password whenever it presents a login screen.

`iiif-auth-client` is written in ES6 with no dependencies and no transpiling. It is therefore not intended for production use unaltered, but as an example implementation. As ES6 it is easier to understand how the IIIF Auth specification orchestrates the user through one or more interaction patterns, because asynchronous user behaviour and HTTP requests to services can be encapsulated in `async` functions.

## First-party and third-party copies

The access services rely on the browser sending cookies with requests for content, e.g. an `<img>` element's `src`. When the client is on a different site from the server, those are third-party cookies, and many browsers now block or partition them. To see the difference, run two copies of this same code:

* **Third-party**: GitHub Pages publishes this repo as-is, at [tomcrane.github.io/iiif-auth-client](https://tomcrane.github.io/iiif-auth-client/).
* **First-party**: run the Docker image on the same site as the server, e.g. `client.example.org` next to `iiifauth.example.org`, or a path on the same domain.

## Docker

The `Dockerfile` builds an nginx image (non-root, port 8080) that serves the client's static files.

```
docker build -t iiif-auth-client .
docker run -p 8080:8080 iiif-auth-client
```

Then visit `http://localhost:8080/?collection=<server>/collection.json`.

To serve the client under a path rather than at the root, set `CLIENT_BASE_PATH` (it must start and end with `/`), e.g. for an ALB path rule that sends `/client/*` to this container:

```
docker run -p 8080:8080 -e CLIENT_BASE_PATH=/client/ iiif-auth-client
```

`/healthz` returns 200 for load balancer health checks.

## Publishing to Amazon ECR

`.github/workflows/docker.yml` builds the image for every pull request and push. Once it's configured, it pushes the image to ECR from `master` and `v*` tags. It's the same workflow as iiif-auth-server's; see [Publishing to Amazon ECR](https://github.com/tomcrane/iiif-auth-server#publishing-to-amazon-ecr) in that repo's README for the AWS and GitHub setup, which covers both repositories.
