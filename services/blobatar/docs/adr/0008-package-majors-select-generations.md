# Package majors select generations

Blobatar's package major is the library's generation selector: `blobatar@1`
renders gen1 and `blobatar@2` renders gen2. Version 2 removes the runtime
`generation` option and the public generation, shape-value and composition
entry points. Shapes remain independently implemented behind a private
composition seam, so adding one does not duplicate the renderer, but new
default shapes ship only in a major release. This makes upgrading the package
the explicit opt-in to seed→look churn and keeps the normal interface and bundle
free of historical implementations.

The endpoint follows a different lifecycle because its callers do not control
deployments. An omitted `gen` serves the current generation and may change when
the endpoint changes; an explicit supported `?gen=` is immutable and receives
the long-lived cache. The endpoint renders historical generations by depending
on their frozen package majors under aliases, so only the endpoint carries that
compatibility cost. Existing unversioned URLs deliberately move to gen2 when it
becomes the endpoint default.

Gen2 preserves its existing golden output byte-for-byte. Future shape rosters
continue to use weighted bands and arrive on majors; a stable bucket allocator
is deferred until reduced churn within a major is an actual requirement.
