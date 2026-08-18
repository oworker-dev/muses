# Image To Editable Host Integration

Status: integration placeholder; no host adapter exists.

The proposed Muses integration is:

```text
authorize source Asset
-> reserve credits
-> submit a host-neutral conversion
-> observe and verify the result
-> ingest output Assets and Provenance
-> map EditableSceneManifest to a DesignDocument Command
-> place the resulting Artifact through the Operation Gateway
-> settle or release credits
```

The Media Service must not receive Muses database access or become the authority
for Workspace, Asset, credit, DesignDocument, or canvas state. Exact files,
environment variables, verification, and rollback steps will be added only when
implementation is approved.
