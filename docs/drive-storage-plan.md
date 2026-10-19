# Private Google Drive storage

- Derive category/format destinations from the canonical format registry: inline creation plus incoming inline/runtime conversion targets, excluding read-only formats.
- Reuse the existing Drive module and D1 metadata, with atomic D1 reservations and pre-generated Google IDs for retry-safe folders/uploads.
- Save final job artifacts to Drive only; retain D1 staging for runner input/output and old artifacts. Verify stored bytes before metadata and completion.
- Keep files private and deliver through authenticated application endpoints. Persist upload recovery records before remote writes.
- Test with mocked Google/D1 responses; report live initialization and download verification separately. Do not modify credentials or deploy without authorization.