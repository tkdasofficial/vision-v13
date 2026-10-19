# VISION — File-Format Capabilities (Audit)

> Generated on 2026-10-14 from the live code, not from marketing copy. Sources audited: `src/lib/formats/inventory.ts` (canonical registry), `src/lib/formats/convert.ts` (Worker-side converters), `src/lib/tools/registry.server.ts` (chat tools), `src/lib/runtime/operations.ts` (background-job registry), `security/archive/zip-guard.ts`, `src/lib/zip-analyzer.ts`, `src/lib/zip-export.ts`, the `tkdasofficial/vision-runtime` GitHub Actions repo (`runtime/`, `tests/`), and the test suites `src/test/formats.test.ts`, `src/test/runtime-ops.test.ts`, `src/test/tools.test.ts`.

No application behaviour was changed to produce this document.

## Contents
- 1. Where each operation runs
- 2. Verification legend
- 3. Summary tables
- 4. The 131-entry inventory, duplicates and aliases
- 5. Complete format inventory by category
- 6. Creation support
- 7. Reading & analysis
- 8. Transformation & conversion matrix
- 9. ZIP support
- 10. Other file tools
- 11. Unsupported and partial capabilities
- 12. How to re-verify

## 1. Where each operation runs

| Layer | What runs there | Code |
|---|---|---|
| **Cloudflare Worker (inline)** — the app backend itself; TanStack Start server functions/server routes on workerd | Text/structured parsing and writing (CSV, JSON, YAML, TOML, XML, SQL INSERTs, subtitles, vCard/iCal, GPX/KML/GeoJSON, notebooks, logs/diffs), DOCX/PDF/XLSX/ODS/EPUB writers, PDF merge/split/watermark, ZIP/TAR/GZ repacking, CBZ→PDF, WOFF→TTF/OTF, draw.io extraction, all chat tools | `src/lib/formats/convert.ts`, `src/lib/tools/*.ts`, `src/routes/api/*` |
| **Cloudflare Workers AI** | OCR / image description, speech-to-text, the LLM that writes document content and plans tool steps | `src/lib/tools/ai.server.ts`, `src/lib/jobs/agent.server.ts` |
| **Cloudflare D1 / gateway Worker** | Job records, artifact index, status; the gateway Worker dispatches runtime jobs | `src/lib/runtime/runtime.server.ts`, `auth-gateway/src/runtime.ts` |
| **Google Drive** | Storage of uploaded user files and runtime outputs (index rows in D1 `user_files`) | `src/lib/cloud/drive.server.ts` |
| **GitHub Actions (`tkdasofficial/vision-runtime`)** | Native-tool jobs: Pillow (images), FFmpeg (audio/video), LibreOffice (office), pandas/pyarrow/fastavro/sqlite3 (data), 7-Zip/libarchive (archives), Calibre (e-books), fontTools (fonts), Graphviz/PlantUML/Mermaid/pdflatex/ezdxf (render), large-file checksums | `src/lib/runtime/operations.ts` ↔ `runtime/operations.py` |
| **Browser** | ZIP analysis of a dropped archive (JSZip), project → ZIP download, code-block downloads | `src/lib/zip-analyzer.ts`, `src/lib/zip-export.ts`, `src/lib/code-files.ts` |

Runtime jobs: max 2 active per user, 6 globally, 10-minute queue grace; per-operation input limit 25 MB (render 5 MB); timeouts 5–25 min; every output is re-checked by magic bytes/parse before delivery (`outputMatches`).

## 2. Verification legend

| Mark | Meaning |
|---|---|
| ✅ live | Exercised end-to-end in the real app, signed in with a real user account, during the 131-format integration pass (CSV→JSON, SRT→VTT, WAV→MP3, RTF→ODT, PNG→HEIC refusal). |
| ✅ unit | Covered by an automated Vitest case that runs the real Worker converter on a fixture and re-reads the output with an independent parser (`src/test/formats.test.ts` → "every inline conversion produces a re-readable file"). |
| ✅ runtime-CI | Covered by a pytest case in `vision-runtime/tests` that runs the real native tool in GitHub Actions and re-reads the output. |
| ⚠️ untested | Implemented and routed in code, but no automated or live test exercises that exact source→target pair. Treat as implemented-but-unverified. |
| 🟡 partial | Works with documented loss (e.g. text-only, values-only) — see notes. |
| ❌ unsupported | Explicitly refused with an explanation. |

Last recorded results: app suite 952 passed / 1 skipped; runtime suite 40 passed in GitHub Actions.

## 3. Summary tables

| Metric | Count |
|---|---|
| Inventory entries (as originally specified, with duplicates) | 131 |
| Canonical formats in the registry | 121 |
| Formats that can be **created** from scratch | 72 |
| Formats with inline **content reading** | 100 |
| Formats only **inspected/identified** inline (content read via conversion on the runtime) | 21 |
| Formats with ≥1 **conversion** target | 121 |
| Source→target conversion pairs (total) | 815 |
| — inline (Cloudflare Worker) | 432 |
| — runtime (GitHub Actions) | 383 |
| Pairs ✅ unit-tested | 417 |
| Pairs ✅ runtime-CI-tested | 42 |
| Pairs ✅ live-tested | 4 |
| Pairs with any test | 456 |
| Pairs ⚠️ untested | 359 |

### Category-wise counts

| Category | Formats | Create | Read inline | Convertible | Pairs (inline / runtime) | Tested pairs | Untested pairs |
|---|---|---|---|---|---|---|---|
| Documents | 9 | 7 | 8 | 9 | 41 / 14 | 34 | 21 |
| Spreadsheets | 5 | 4 | 4 | 5 | 52 / 10 | 52 | 10 |
| Data & databases | 7 | 4 | 4 | 7 | 50 / 15 | 56 | 9 |
| Presentations | 3 | 0 | 2 | 3 | 8 / 9 | 8 | 9 |
| Code / development | 25 | 25 | 25 | 25 | 126 / 0 | 126 | 0 |
| Configuration | 9 | 9 | 9 | 9 | 57 / 0 | 57 | 0 |
| Images | 10 | 1 | 10 | 10 | 1 / 75 | 8 | 68 |
| Audio | 9 | 0 | 9 | 9 | 0 / 72 | 8 | 64 |
| Video | 9 | 0 | 0 | 9 | 0 / 135 | 8 | 127 |
| Archives | 6 | 4 | 4 | 6 | 11 / 10 | 12 | 9 |
| Subtitles / transcripts | 5 | 5 | 5 | 5 | 30 / 0 | 30 | 0 |
| E-books / publishing | 6 | 2 | 3 | 6 | 13 / 22 | 9 | 26 |
| Diagrams / graphics | 5 | 3 | 5 | 5 | 12 / 12 | 16 | 8 |
| Fonts | 4 | 0 | 4 | 4 | 2 / 8 | 3 | 7 |
| Maps / geo | 4 | 3 | 3 | 4 | 9 / 1 | 9 | 1 |
| Contacts | 1 | 1 | 1 | 1 | 3 / 0 | 3 | 0 |
| Calendars | 1 | 1 | 1 | 1 | 3 / 0 | 3 | 0 |
| Logs / diffs | 3 | 3 | 3 | 3 | 14 / 0 | 14 | 0 |
| **Total** | **121** | **72** | **100** | **121** | **432 / 383** | **456** | **359** |

## 4. The 131-entry inventory, duplicates and aliases

The original list has 131 entries. Several are the same format listed twice or alternate extensions, so they collapse to 121 canonical formats. Every entry is mapped (asserted by `formats.test.ts` → "keeps all 131 inventory entries…").

| # | Group (as specified) | Entry | Canonical format | Note |
|---|---|---|---|---|
| 1 | Documents | PDF | PDF (`pdf`) |  |
| 2 | Documents | DOC | Word 97-2003 (`doc`) |  |
| 3 | Documents | DOCX | Word (`docx`) |  |
| 4 | Documents | TXT | Plain text (`txt`) |  |
| 5 | Documents | MD | Markdown (`md`) |  |
| 6 | Documents | RTF | Rich Text (`rtf`) |  |
| 7 | Documents | ODT | OpenDocument Text (`odt`) |  |
| 8 | Documents | HTML | HTML (`html`) |  |
| 9 | Documents | EPUB | EPUB (`epub`) |  |
| 10 | Documents | TEX | LaTeX (`tex`) |  |
| 11 | Spreadsheets/data | XLS | Excel 97-2003 (`xls`) |  |
| 12 | Spreadsheets/data | XLSX | Excel (`xlsx`) |  |
| 13 | Spreadsheets/data | CSV | CSV (`csv`) |  |
| 14 | Spreadsheets/data | ODS | OpenDocument Spreadsheet (`ods`) |  |
| 15 | Spreadsheets/data | TSV | TSV (`tsv`) |  |
| 16 | Spreadsheets/data | JSON | JSON (`json`) |  |
| 17 | Spreadsheets/data | JSONL | JSON Lines (`jsonl`) |  |
| 18 | Spreadsheets/data | XML | XML (`xml`) |  |
| 19 | Spreadsheets/data | YAML | YAML (`yaml`) |  |
| 20 | Spreadsheets/data | TOML | TOML (`toml`) |  |
| 21 | Spreadsheets/data | SQL | SQL (`sql`) |  |
| 22 | Spreadsheets/data | DB | SQLite database (`sqlite`) | Alias → `sqlite` |
| 23 | Spreadsheets/data | SQLite | SQLite database (`sqlite`) | Duplicate of #22 |
| 24 | Presentations | PPT | PowerPoint 97-2003 (`ppt`) |  |
| 25 | Presentations | PPTX | PowerPoint (`pptx`) |  |
| 26 | Presentations | ODP | OpenDocument Presentation (`odp`) |  |
| 27 | Code/development | CSS | CSS (`css`) |  |
| 28 | Code/development | JS | JavaScript (`js`) |  |
| 29 | Code/development | JSX | JSX (`jsx`) |  |
| 30 | Code/development | TS | TypeScript (`ts`) |  |
| 31 | Code/development | TSX | TSX (`tsx`) |  |
| 32 | Code/development | MJS | ES module (`mjs`) |  |
| 33 | Code/development | CJS | CommonJS (`cjs`) |  |
| 34 | Code/development | PY | Python (`py`) |  |
| 35 | Code/development | JAVA | Java (`java`) |  |
| 36 | Code/development | C | C (`c`) |  |
| 37 | Code/development | CPP | C++ (`cpp`) |  |
| 38 | Code/development | H | C header (`h`) |  |
| 39 | Code/development | HPP | C++ header (`hpp`) |  |
| 40 | Code/development | CS | C# (`cs`) |  |
| 41 | Code/development | GO | Go (`go`) |  |
| 42 | Code/development | RS | Rust (`rs`) |  |
| 43 | Code/development | PHP | PHP (`php`) |  |
| 44 | Code/development | RB | Ruby (`rb`) |  |
| 45 | Code/development | SWIFT | Swift (`swift`) |  |
| 46 | Code/development | KT | Kotlin (`kt`) |  |
| 47 | Code/development | KTS | Kotlin script (`kts`) |  |
| 48 | Code/development | SH | Shell script (`sh`) |  |
| 49 | Code/development | BAT | Batch file (`bat`) |  |
| 50 | Code/development | PS1 | PowerShell (`ps1`) |  |
| 51 | Code/development | IPYNB | Jupyter notebook (`ipynb`) |  |
| 52 | Code/development | ENV | Env file (`env`) |  |
| 53 | Code/development | INI | INI (`ini`) |  |
| 54 | Code/development | CFG | CFG config (`cfg`) |  |
| 55 | Code/development | CONF | CONF config (`conf`) |  |
| 56 | Code/development | PROPERTIES | Java properties (`properties`) |  |
| 57 | Code/development | DOCKERFILE | Dockerfile (`dockerfile`) |  |
| 58 | Code/development | GITIGNORE | .gitignore (`gitignore`) |  |
| 59 | Code/development | HTML | HTML (`html`) | Duplicate of #8 |
| 60 | Code/development | SQL | SQL (`sql`) | Duplicate of #21 |
| 61 | Code/development | TOML | TOML (`toml`) | Duplicate of #20 |
| 62 | Code/development | YAML | YAML (`yaml`) | Duplicate of #19 |
| 63 | Code/development | YML | YAML (`yaml`) | Duplicate of #19 (alias → `yaml`) |
| 64 | Images | PNG | PNG (`png`) |  |
| 65 | Images | JPG | JPEG (`jpeg`) | Alias → `jpeg` |
| 66 | Images | JPEG | JPEG (`jpeg`) | Duplicate of #65 |
| 67 | Images | WEBP | WebP (`webp`) |  |
| 68 | Images | BMP | BMP (`bmp`) |  |
| 69 | Images | TIFF | TIFF (`tiff`) |  |
| 70 | Images | TIF | TIFF (`tiff`) | Duplicate of #69 (alias → `tiff`) |
| 71 | Images | GIF | GIF (`gif`) |  |
| 72 | Images | ICO | ICO (`ico`) |  |
| 73 | Images | SVG | SVG (`svg`) |  |
| 74 | Images | AVIF | AVIF (`avif`) |  |
| 75 | Images | HEIC | HEIC (`heic`) |  |
| 76 | Audio | WAV | WAV (`wav`) |  |
| 77 | Audio | MP3 | MP3 (`mp3`) |  |
| 78 | Audio | FLAC | FLAC (`flac`) |  |
| 79 | Audio | OGG | Ogg Vorbis (`ogg`) |  |
| 80 | Audio | M4A | M4A (`m4a`) |  |
| 81 | Audio | AAC | AAC (`aac`) |  |
| 82 | Audio | WMA | WMA (`wma`) |  |
| 83 | Audio | OPUS | Opus (`opus`) |  |
| 84 | Audio | AIFF | AIFF (`aiff`) |  |
| 85 | Video | MP4 | MP4 (`mp4`) |  |
| 86 | Video | WEBM | WebM (`webm`) |  |
| 87 | Video | MOV | QuickTime (`mov`) |  |
| 88 | Video | MKV | Matroska (`mkv`) |  |
| 89 | Video | AVI | AVI (`avi`) |  |
| 90 | Video | WMV | WMV (`wmv`) |  |
| 91 | Video | M4V | M4V (`m4v`) |  |
| 92 | Video | MPEG | MPEG (`mpeg`) |  |
| 93 | Video | MPG | MPEG (`mpeg`) | Duplicate of #92 (alias → `mpeg`) |
| 94 | Video | 3GP | 3GP (`3gp`) |  |
| 95 | Archives | ZIP | ZIP (`zip`) |  |
| 96 | Archives | TAR | TAR (`tar`) |  |
| 97 | Archives | GZ | Gzip (`gz`) |  |
| 98 | Archives | TGZ | Tar.gz (`tgz`) |  |
| 99 | Archives | 7Z | 7-Zip (`7z`) |  |
| 100 | Archives | RAR | RAR (`rar`) |  |
| 101 | Subtitles/transcripts | SRT | SubRip (`srt`) |  |
| 102 | Subtitles/transcripts | VTT | WebVTT (`vtt`) |  |
| 103 | Subtitles/transcripts | ASS | Advanced SubStation (`ass`) |  |
| 104 | Subtitles/transcripts | SSA | SubStation Alpha (`ssa`) |  |
| 105 | Subtitles/transcripts | LRC | LRC lyrics (`lrc`) |  |
| 106 | E-books/publishing | MOBI | Mobipocket (`mobi`) |  |
| 107 | E-books/publishing | AZW3 | Kindle AZW3 (`azw3`) |  |
| 108 | E-books/publishing | FB2 | FictionBook (`fb2`) |  |
| 109 | E-books/publishing | CBZ | Comic ZIP (`cbz`) |  |
| 110 | E-books/publishing | CBR | Comic RAR (`cbr`) |  |
| 111 | Graphics/diagrams/design | SVG | SVG (`svg`) | Duplicate of #73 |
| 112 | Graphics/diagrams/design | MMD | Mermaid (`mmd`) |  |
| 113 | Graphics/diagrams/design | DOT | Graphviz DOT (`dot`) |  |
| 114 | Graphics/diagrams/design | DRAWIO | draw.io XML (`drawio`) |  |
| 115 | Graphics/diagrams/design | PUML | PlantUML (`puml`) |  |
| 116 | Graphics/diagrams/design | DXF | AutoCAD DXF (`dxf`) |  |
| 117 | Fonts | TTF | TrueType (`ttf`) |  |
| 118 | Fonts | OTF | OpenType (`otf`) |  |
| 119 | Fonts | WOFF | WOFF (`woff`) |  |
| 120 | Fonts | WOFF2 | WOFF2 (`woff2`) |  |
| 121 | Other technical | VCF | vCard (`vcf`) |  |
| 122 | Other technical | ICS | iCalendar (`ics`) |  |
| 123 | Other technical | KML | KML (`kml`) |  |
| 124 | Other technical | GPX | GPX (`gpx`) |  |
| 125 | Other technical | GEOJSON | GeoJSON (`geojson`) |  |
| 126 | Other technical | SHP | Shapefile (zipped) (`shp`) |  |
| 127 | Other technical | PARQUET | Apache Parquet (`parquet`) |  |
| 128 | Other technical | AVRO | Apache Avro (`avro`) |  |
| 129 | Other technical | LOG | Log file (`log`) |  |
| 130 | Other technical | DIFF | Diff (`diff`) |  |
| 131 | Other technical | PATCH | Patch (`patch`) |  |

**Name aliases accepted in prompts** (`canonicalId`): jpg→jpeg, tif→tiff, mpg→mpeg, yml→yaml, db/sqlite3→sqlite, htm→html, markdown→md, word→docx, excel→xlsx, text→txt, tar.gz→tgz, mermaid→mmd, plantuml→puml, graphviz→dot, draw.io→drawio, vcard→vcf, ical→ics, gzip→gz, ndjson→jsonl.

**Special file names** (`formatOfName`): `Dockerfile`, `Dockerfile.*`, `*.dockerfile` → dockerfile; `.gitignore` → gitignore; `.env`, `.env.*` → env; `*.tar.gz` → tgz; `*.drawio.xml`, `*.drawio.svg` → drawio.

**Content signatures**: for formats with a magic-byte signature (PDF, PNG, JPEG, ZIP-based office files, SQLite, Parquet, fonts, RAR, 7z, media containers, …) an upload whose bytes don't match its extension is rejected before conversion.

## 5. Complete format inventory by category

### Documents (9)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| PDF (`pdf`) | .pdf | application/pdf | ✔ inline | ✔ | 5 targets | Text-only extraction when converting from PDF; layout/images are not kept. Built-in PDF font cannot draw non-Latin scripts — reported, never silently dropped. |
| Word 97-2003 (`doc`) | .doc | application/msword | identify only | — | 6 targets |  |
| Word (`docx`) | .docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document | ✔ inline | ✔ | 8 targets |  |
| Plain text (`txt`) | .txt .text | text/plain | ✔ inline | ✔ | 5 targets |  |
| Markdown (`md`) | .md .markdown | text/markdown | ✔ inline | ✔ | 5 targets |  |
| Rich Text (`rtf`) | .rtf | application/rtf | ✔ inline | ✔ | 8 targets | Inline reading keeps text only; formatting kept via the runtime. |
| OpenDocument Text (`odt`) | .odt | application/vnd.oasis.opendocument.text | ✔ inline | — | 8 targets |  |
| HTML (`html`) | .html .htm | text/html | ✔ inline | ✔ | 7 targets | Scripts are never run; tables can be extracted. |
| LaTeX (`tex`) | .tex .latex | application/x-tex | ✔ inline | ✔ | 3 targets | Compiled with pdflatex, shell-escape disabled. |

### Spreadsheets (5)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| Excel 97-2003 (`xls`) | .xls | application/vnd.ms-excel | identify only | — | 5 targets |  |
| Excel (`xlsx`) | .xlsx .xlsm | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | ✔ inline | ✔ | 14 targets | Values only; formulas, charts and styles are not kept inline. |
| CSV (`csv`) | .csv | text/csv | ✔ inline | ✔ | 16 targets |  |
| OpenDocument Spreadsheet (`ods`) | .ods | application/vnd.oasis.opendocument.spreadsheet | ✔ inline | ✔ | 14 targets |  |
| TSV (`tsv`) | .tsv .tab | text/tab-separated-values | ✔ inline | ✔ | 13 targets |  |

### Data & databases (7)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| JSON (`json`) | .json | application/json | ✔ inline | ✔ | 19 targets |  |
| JSON Lines (`jsonl`) | .jsonl .ndjson | application/x-ndjson | ✔ inline | ✔ | 13 targets |  |
| XML (`xml`) | .xml | application/xml | ✔ inline | ✔ | 14 targets | External entities are never resolved. |
| SQL (`sql`) | .sql | application/sql | ✔ inline | ✔ | 7 targets | INSERT statements are parsed into tables; SQL is never executed. |
| SQLite database (`sqlite`) | .sqlite .sqlite3 .db | application/vnd.sqlite3 | identify only | — | 4 targets | Opened read-only on the runtime; DB entries are verified by the SQLite header. |
| Apache Parquet (`parquet`) | .parquet | application/vnd.apache.parquet | identify only | — | 4 targets |  |
| Apache Avro (`avro`) | .avro | application/avro | identify only | — | 4 targets |  |

### Presentations (3)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| PowerPoint 97-2003 (`ppt`) | .ppt | application/vnd.ms-powerpoint | identify only | — | 3 targets |  |
| PowerPoint (`pptx`) | .pptx | application/vnd.openxmlformats-officedocument.presentationml.presentation | ✔ inline | — | 7 targets | Inline conversion extracts slide text. |
| OpenDocument Presentation (`odp`) | .odp | application/vnd.oasis.opendocument.presentation | ✔ inline | — | 7 targets |  |

### Code / development (25)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| CSS (`css`) | .css | text/css | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| JavaScript (`js`) | .js | text/javascript | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| JSX (`jsx`) | .jsx | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| TypeScript (`ts`) | .ts | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| TSX (`tsx`) | .tsx | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| ES module (`mjs`) | .mjs | text/javascript | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| CommonJS (`cjs`) | .cjs | text/javascript | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Python (`py`) | .py | text/x-python | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Java (`java`) | .java | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| C (`c`) | .c | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| C++ (`cpp`) | .cpp .cc .cxx | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| C header (`h`) | .h | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| C++ header (`hpp`) | .hpp .hh | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| C# (`cs`) | .cs | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Go (`go`) | .go | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Rust (`rs`) | .rs | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| PHP (`php`) | .php | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Ruby (`rb`) | .rb | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Swift (`swift`) | .swift | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Kotlin (`kt`) | .kt | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Kotlin script (`kts`) | .kts | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Shell script (`sh`) | .sh .bash | application/x-sh | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Batch file (`bat`) | .bat .cmd | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| PowerShell (`ps1`) | .ps1 | text/plain | ✔ inline | ✔ | 5 targets | Treated as text; never executed. |
| Jupyter notebook (`ipynb`) | .ipynb | application/x-ipynb+json | ✔ inline | ✔ | 6 targets | Cells are converted, never executed. |

### Configuration (9)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| YAML (`yaml`) | .yaml .yml | application/yaml | ✔ inline | ✔ | 16 targets |  |
| TOML (`toml`) | .toml | application/toml | ✔ inline | ✔ | 6 targets |  |
| Env file (`env`) | .env | text/plain | ✔ inline | ✔ | 5 targets | Values that look like secrets are flagged when inspected. |
| INI (`ini`) | .ini | text/plain | ✔ inline | ✔ | 5 targets |  |
| CFG config (`cfg`) | .cfg | text/plain | ✔ inline | ✔ | 4 targets | Parsed as INI-style sections. |
| CONF config (`conf`) | .conf | text/plain | ✔ inline | ✔ | 4 targets | Parsed as INI-style key=value; other syntaxes are kept as text. |
| Java properties (`properties`) | .properties | text/plain | ✔ inline | ✔ | 5 targets |  |
| Dockerfile (`dockerfile`) | .dockerfile | text/plain | ✔ inline | ✔ | 6 targets | Instructions are listed, never built. |
| .gitignore (`gitignore`) | .gitignore | text/plain | ✔ inline | ✔ | 6 targets |  |

### Images (10)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| PNG (`png`) | .png | image/png | ✔ inline | — | 8 targets | Pixel conversion on the runtime (Pillow). Reading = OCR/description; no image generation. |
| JPEG (`jpeg`) | .jpg .jpeg | image/jpeg | ✔ inline | — | 8 targets | Pixel conversion on the runtime (Pillow). Reading = OCR/description; no image generation. |
| WebP (`webp`) | .webp | image/webp | ✔ inline | — | 8 targets | Pixel conversion on the runtime (Pillow). Reading = OCR/description; no image generation. |
| BMP (`bmp`) | .bmp | image/bmp | ✔ inline | — | 8 targets | Pixel conversion on the runtime (Pillow). Reading = OCR/description; no image generation. |
| TIFF (`tiff`) | .tiff .tif | image/tiff | ✔ inline | — | 8 targets | Pixel conversion on the runtime (Pillow). Reading = OCR/description; no image generation. |
| GIF (`gif`) | .gif | image/gif | ✔ inline | — | 8 targets | Pixel conversion on the runtime (Pillow). Reading = OCR/description; no image generation. |
| ICO (`ico`) | .ico | image/x-icon | ✔ inline | — | 8 targets | Pixel conversion on the runtime (Pillow). Reading = OCR/description; no image generation. |
| AVIF (`avif`) | .avif | image/avif | ✔ inline | — | 8 targets | Pixel conversion on the runtime (Pillow). Reading = OCR/description; no image generation. |
| HEIC (`heic`) | .heic .heif | image/heic | ✔ inline | — | 9 targets | Decoded on the runtime (libheif); HEIC is not written as an output. |
| SVG (`svg`) | .svg | image/svg+xml | ✔ inline | ✔ | 3 targets | Scripts/external references are reported on inspect; rendered with CairoSVG (no network). |

### Audio (9)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| WAV (`wav`) | .wav | audio/wav | ✔ inline | — | 8 targets | Decoded and re-encoded with FFmpeg; lossy targets lose quality. Reading = speech-to-text. |
| MP3 (`mp3`) | .mp3 | audio/mpeg | ✔ inline | — | 8 targets | Decoded and re-encoded with FFmpeg; lossy targets lose quality. Reading = speech-to-text. |
| FLAC (`flac`) | .flac | audio/flac | ✔ inline | — | 8 targets | Decoded and re-encoded with FFmpeg; lossy targets lose quality. Reading = speech-to-text. |
| Ogg Vorbis (`ogg`) | .ogg .oga | audio/ogg | ✔ inline | — | 8 targets | Decoded and re-encoded with FFmpeg; lossy targets lose quality. Reading = speech-to-text. |
| M4A (`m4a`) | .m4a | audio/mp4 | ✔ inline | — | 8 targets | Decoded and re-encoded with FFmpeg; lossy targets lose quality. Reading = speech-to-text. |
| AAC (`aac`) | .aac | audio/aac | ✔ inline | — | 8 targets | Decoded and re-encoded with FFmpeg; lossy targets lose quality. Reading = speech-to-text. |
| WMA (`wma`) | .wma | audio/x-ms-wma | ✔ inline | — | 8 targets | Decoded and re-encoded with FFmpeg; lossy targets lose quality. Reading = speech-to-text. |
| Opus (`opus`) | .opus | audio/opus | ✔ inline | — | 8 targets | Decoded and re-encoded with FFmpeg; lossy targets lose quality. Reading = speech-to-text. |
| AIFF (`aiff`) | .aiff .aif | audio/aiff | ✔ inline | — | 8 targets | Decoded and re-encoded with FFmpeg; lossy targets lose quality. Reading = speech-to-text. |

### Video (9)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| MP4 (`mp4`) | .mp4 | video/mp4 | identify only | — | 15 targets | Transcoded with FFmpeg (max 15 min); audio can be extracted via audio_convert. No video generation. |
| WebM (`webm`) | .webm | video/webm | identify only | — | 15 targets | Transcoded with FFmpeg (max 15 min); audio can be extracted via audio_convert. No video generation. |
| QuickTime (`mov`) | .mov | video/quicktime | identify only | — | 15 targets | Transcoded with FFmpeg (max 15 min); audio can be extracted via audio_convert. No video generation. |
| Matroska (`mkv`) | .mkv | video/x-matroska | identify only | — | 15 targets | Transcoded with FFmpeg (max 15 min); audio can be extracted via audio_convert. No video generation. |
| AVI (`avi`) | .avi | video/x-msvideo | identify only | — | 15 targets | Transcoded with FFmpeg (max 15 min); audio can be extracted via audio_convert. No video generation. |
| WMV (`wmv`) | .wmv | video/x-ms-wmv | identify only | — | 15 targets | Transcoded with FFmpeg (max 15 min); audio can be extracted via audio_convert. No video generation. |
| M4V (`m4v`) | .m4v | video/x-m4v | identify only | — | 15 targets | Transcoded with FFmpeg (max 15 min); audio can be extracted via audio_convert. No video generation. |
| MPEG (`mpeg`) | .mpeg .mpg | video/mpeg | identify only | — | 15 targets | Transcoded with FFmpeg (max 15 min); audio can be extracted via audio_convert. No video generation. |
| 3GP (`3gp`) | .3gp | video/3gpp | identify only | — | 15 targets | Transcoded with FFmpeg (max 15 min); audio can be extracted via audio_convert. No video generation. |

### Archives (6)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| ZIP (`zip`) | .zip | application/zip | ✔ inline | ✔ | 4 targets | Listing/extraction checks paths, links, sizes and entry counts (ZIP-slip and bomb safe). |
| TAR (`tar`) | .tar | application/x-tar | ✔ inline | ✔ | 4 targets |  |
| Gzip (`gz`) | .gz .gzip | application/gzip | ✔ inline | ✔ | 2 targets | Decompressed with a size ceiling; gzip of a TAR is handled as TGZ. |
| Tar.gz (`tgz`) | .tgz .tar.gz | application/gzip | ✔ inline | ✔ | 4 targets |  |
| 7-Zip (`7z`) | .7z | application/x-7z-compressed | identify only | — | 3 targets | Encrypted archives are refused. |
| RAR (`rar`) | .rar | application/vnd.rar | identify only | — | 4 targets | RAR is read-only (proprietary encoder); encrypted archives are refused. |

### Subtitles / transcripts (5)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| SubRip (`srt`) | .srt | application/x-subrip | ✔ inline | ✔ | 6 targets |  |
| WebVTT (`vtt`) | .vtt | text/vtt | ✔ inline | ✔ | 6 targets |  |
| Advanced SubStation (`ass`) | .ass | text/x-ass | ✔ inline | ✔ | 6 targets | Styling/positioning tags are dropped when converting to other formats. |
| SubStation Alpha (`ssa`) | .ssa | text/x-ssa | ✔ inline | ✔ | 6 targets | Styling tags are dropped when converting. |
| LRC lyrics (`lrc`) | .lrc | text/plain | ✔ inline | ✔ | 6 targets | LRC has start times only; end times are inferred from the next line. |

### E-books / publishing (6)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| EPUB (`epub`) | .epub | application/epub+zip | ✔ inline | ✔ | 8 targets |  |
| Mobipocket (`mobi`) | .mobi .prc | application/x-mobipocket-ebook | identify only | — | 7 targets | DRM-protected books cannot be converted. |
| Kindle AZW3 (`azw3`) | .azw3 .azw | application/vnd.amazon.ebook | identify only | — | 7 targets | DRM-protected books cannot be converted. |
| FictionBook (`fb2`) | .fb2 | application/x-fictionbook+xml | ✔ inline | — | 8 targets |  |
| Comic ZIP (`cbz`) | .cbz | application/vnd.comicbook+zip | ✔ inline | ✔ | 3 targets | PDF output embeds JPEG/PNG pages only. |
| Comic RAR (`cbr`) | .cbr | application/vnd.comicbook-rar | identify only | — | 2 targets |  |

### Diagrams / graphics (5)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| Mermaid (`mmd`) | .mmd .mermaid | text/plain | ✔ inline | ✔ | 5 targets |  |
| Graphviz DOT (`dot`) | .dot .gv | text/vnd.graphviz | ✔ inline | ✔ | 5 targets |  |
| draw.io XML (`drawio`) | .drawio .dio | application/vnd.jgraph.mxfile | ✔ inline | — | 4 targets | Shapes/edges are extracted (compressed diagrams decoded); no headless draw.io renderer is available, render via the exported DOT/Mermaid. |
| PlantUML (`puml`) | .puml .plantuml .pu | text/plain | ✔ inline | ✔ | 5 targets | Rendered in PlantUML's sandbox security profile. |
| AutoCAD DXF (`dxf`) | .dxf | image/vnd.dxf | ✔ inline | — | 5 targets |  |

### Fonts (4)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| TrueType (`ttf`) | .ttf | font/ttf | ✔ inline | — | 2 targets | TTF↔OTF outline conversion is not offered (would alter glyphs). |
| OpenType (`otf`) | .otf | font/otf | ✔ inline | — | 2 targets |  |
| WOFF (`woff`) | .woff | font/woff | ✔ inline | — | 3 targets | Inline unwrap picks TTF or OTF by outline type. |
| WOFF2 (`woff2`) | .woff2 | font/woff2 | ✔ inline | — | 3 targets |  |

### Maps / geo (4)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| KML (`kml`) | .kml | application/vnd.google-earth.kml+xml | ✔ inline | ✔ | 3 targets |  |
| GPX (`gpx`) | .gpx | application/gpx+xml | ✔ inline | ✔ | 3 targets |  |
| GeoJSON (`geojson`) | .geojson | application/geo+json | ✔ inline | ✔ | 3 targets |  |
| Shapefile (zipped) (`shp`) | .shp | application/zip | identify only | — | 1 targets | Send as a .zip containing .shp/.shx/.dbf. |

### Contacts (1)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| vCard (`vcf`) | .vcf .vcard | text/vcard | ✔ inline | ✔ | 3 targets |  |

### Calendars (1)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| iCalendar (`ics`) | .ics .ical | text/calendar | ✔ inline | ✔ | 3 targets |  |

### Logs / diffs (3)

| Format | Extensions | MIME | Read | Create | Convert | Notes |
|---|---|---|---|---|---|---|
| Log file (`log`) | .log | text/plain | ✔ inline | ✔ | 4 targets | Lines are split into time/level/message when recognisable. |
| Diff (`diff`) | .diff | text/x-diff | ✔ inline | ✔ | 5 targets |  |
| Patch (`patch`) | .patch | text/x-diff | ✔ inline | ✔ | 5 targets | Patches are summarised, never applied to the server. |

## 6. Creation support

Creation means a brand-new downloadable file is produced from a prompt or from structured data, via the `create_document`, `generate_code`, `convert_data`, `zip_create`, `chart`, `diagram`, `qr_code`, `barcode` tools (all inline in the Worker; content written by the Workers AI LLM where needed). Media generation (images, audio, video) is **not** provided by these tools.

| Category | Creatable formats | Status |
|---|---|---|
| Documents | PDF, DOCX, TXT, MD, RTF, HTML, TEX | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Spreadsheets | XLSX, CSV, ODS, TSV | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Data & databases | JSON, JSONL, XML, SQL | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Code / development | CSS, JS, JSX, TS, TSX, MJS, CJS, PY, JAVA, C, CPP, H, HPP, CS, GO, RS, PHP, RB, SWIFT, KT, KTS, SH, BAT, PS1, IPYNB | ✅ unit (each language converted/re-read); code is never executed |
| Configuration | YAML, TOML, ENV, INI, CFG, CONF, PROPERTIES, DOCKERFILE, GITIGNORE | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Images | SVG | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Archives | ZIP, TAR, GZ, TGZ | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Subtitles / transcripts | SRT, VTT, ASS, SSA, LRC | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| E-books / publishing | EPUB, CBZ | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Diagrams / graphics | MMD, DOT, PUML | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Maps / geo | KML, GPX, GEOJSON | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Contacts | VCF | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Calendars | ICS | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |
| Logs / diffs | LOG, DIFF, PATCH | ✅ unit for writers used by conversion; ⚠️ prompt-driven creation of each type is not individually tested |

Specifically verified by tests: DOCX and PDF re-open with their text (`tools.test.ts`), XLSX round-trip, EPUB with stored `mimetype` first, `create_document` → XLSX, QR SVG, ZIP creation with duplicate-name de-duplication, chart SVG. Code-block downloads in chat use `src/lib/code-files.ts` (extension map for ~40 languages, sanitised filenames; browser-side).

Not creatable: DOC, ODT, XLS, SQLITE, PPT, PPTX, ODP, PNG, JPEG, WEBP, BMP, TIFF, GIF, ICO, AVIF, HEIC, WAV, MP3, FLAC, OGG, M4A, AAC, WMA, OPUS, AIFF, MP4, WEBM, MOV, MKV, AVI, WMV, M4V, MPEG, 3GP, 7Z, RAR, MOBI, AZW3, FB2, CBR, DRAWIO, DXF, TTF, OTF, WOFF, WOFF2, SHP, PARQUET, AVRO. Some of these can still be *produced* as a conversion target (e.g. MP3 from WAV on the runtime).

## 7. Reading & analysis

| Category | Read inline (text/structure extracted in Worker) | Identify / inspect only inline |
|---|---|---|
| Documents | PDF, DOCX, TXT, MD, RTF, ODT, HTML, TEX | DOC |
| Spreadsheets | XLSX, CSV, ODS, TSV | XLS |
| Data & databases | JSON, JSONL, XML, SQL | SQLITE, PARQUET, AVRO |
| Presentations | PPTX, ODP | PPT |
| Code / development | CSS, JS, JSX, TS, TSX, MJS, CJS, PY, JAVA, C, CPP, H, HPP, CS, GO, RS, PHP, RB, SWIFT, KT, KTS, SH, BAT, PS1, IPYNB | — |
| Configuration | YAML, TOML, ENV, INI, CFG, CONF, PROPERTIES, DOCKERFILE, GITIGNORE | — |
| Images | PNG, JPEG, WEBP, BMP, TIFF, GIF, ICO, AVIF, HEIC, SVG | — |
| Audio | WAV, MP3, FLAC, OGG, M4A, AAC, WMA, OPUS, AIFF | — |
| Video | — | MP4, WEBM, MOV, MKV, AVI, WMV, M4V, MPEG, 3GP |
| Archives | ZIP, TAR, GZ, TGZ | 7Z, RAR |
| Subtitles / transcripts | SRT, VTT, ASS, SSA, LRC | — |
| E-books / publishing | EPUB, FB2, CBZ | MOBI, AZW3, CBR |
| Diagrams / graphics | MMD, DOT, DRAWIO, PUML, DXF | — |
| Fonts | TTF, OTF, WOFF, WOFF2 | — |
| Maps / geo | KML, GPX, GEOJSON | SHP |
| Contacts | VCF | — |
| Calendars | ICS | — |
| Logs / diffs | LOG, DIFF, PATCH | — |

Analysis tools on top of reading: `file_info` (type, size, signature), `extract_text`, `ocr` and `describe_image` (Workers AI; images), `transcribe_audio` (Workers AI speech-to-text), `analyze_data` / `query_data` / `statistics` / `chart` (tables from CSV/TSV/XLSX/ODS/JSON…), `summarize`, `translate`, `analyze_text`, `text_stats`, `compare_text`, `privacy_scan`, `validate`, `pdf_metadata`, `zip_list`, `format_support` (answers "can you convert X to Y" from the registry). Image reading means OCR/description — not pixel editing. Video content is not read inline.

## 8. Transformation & conversion matrix

Every pair below is derived from `FORMATS[].inline`, `FORMATS[].runtime.targets` and the video→audio extraction rule in `routeConversion`. Anything not listed is refused with a reason.

### Documents

| Source | Target | Runs on | Verification |
|---|---|---|---|
| PDF | TXT | Cloudflare Worker | ⚠️ untested |
| PDF | MD | Cloudflare Worker | ⚠️ untested |
| PDF | HTML | Cloudflare Worker | ⚠️ untested |
| PDF | DOCX | Cloudflare Worker | ⚠️ untested |
| PDF | EPUB | Cloudflare Worker | ⚠️ untested |
| DOC | PDF | GitHub Actions (`office_convert`) | ⚠️ untested |
| DOC | DOCX | GitHub Actions (`office_convert`) | ⚠️ untested |
| DOC | ODT | GitHub Actions (`office_convert`) | ⚠️ untested |
| DOC | RTF | GitHub Actions (`office_convert`) | ⚠️ untested |
| DOC | TXT | GitHub Actions (`office_convert`) | ⚠️ untested |
| DOC | HTML | GitHub Actions (`office_convert`) | ⚠️ untested |
| DOCX | PDF | Cloudflare Worker | ✅ runtime-CI |
| DOCX | HTML | Cloudflare Worker | ⚠️ untested |
| DOCX | MD | Cloudflare Worker | ⚠️ untested |
| DOCX | TXT | Cloudflare Worker | ⚠️ untested |
| DOCX | EPUB | Cloudflare Worker | ⚠️ untested |
| DOCX | DOC | GitHub Actions (`office_convert`) | ⚠️ untested |
| DOCX | ODT | GitHub Actions (`office_convert`) | ⚠️ untested |
| DOCX | RTF | GitHub Actions (`office_convert`) | ⚠️ untested |
| TXT | PDF | Cloudflare Worker | ✅ unit |
| TXT | DOCX | Cloudflare Worker | ✅ unit |
| TXT | HTML | Cloudflare Worker | ✅ unit |
| TXT | MD | Cloudflare Worker | ✅ unit |
| TXT | EPUB | Cloudflare Worker | ✅ unit, ✅ runtime-CI |
| MD | PDF | Cloudflare Worker | ✅ unit |
| MD | DOCX | Cloudflare Worker | ✅ unit |
| MD | HTML | Cloudflare Worker | ✅ unit |
| MD | TXT | Cloudflare Worker | ✅ unit |
| MD | EPUB | Cloudflare Worker | ✅ unit |
| RTF | PDF | Cloudflare Worker | ✅ unit |
| RTF | DOCX | Cloudflare Worker | ✅ unit |
| RTF | HTML | Cloudflare Worker | ✅ unit |
| RTF | MD | Cloudflare Worker | ✅ unit |
| RTF | TXT | Cloudflare Worker | ✅ unit |
| RTF | EPUB | Cloudflare Worker | ✅ unit |
| RTF | DOC | GitHub Actions (`office_convert`) | ⚠️ untested |
| RTF | ODT | GitHub Actions (`office_convert`) | ✅ live |
| ODT | PDF | Cloudflare Worker | ✅ unit |
| ODT | DOCX | Cloudflare Worker | ✅ unit |
| ODT | HTML | Cloudflare Worker | ✅ unit |
| ODT | MD | Cloudflare Worker | ✅ unit |
| ODT | TXT | Cloudflare Worker | ✅ unit |
| ODT | EPUB | Cloudflare Worker | ✅ unit |
| ODT | DOC | GitHub Actions (`office_convert`) | ⚠️ untested |
| ODT | RTF | GitHub Actions (`office_convert`) | ⚠️ untested |
| HTML | PDF | Cloudflare Worker | ✅ unit |
| HTML | DOCX | Cloudflare Worker | ✅ unit, ✅ runtime-CI |
| HTML | MD | Cloudflare Worker | ✅ unit |
| HTML | TXT | Cloudflare Worker | ✅ unit |
| HTML | EPUB | Cloudflare Worker | ✅ unit |
| HTML | CSV | Cloudflare Worker | ✅ unit |
| HTML | XLSX | Cloudflare Worker | ✅ unit |
| TEX | TXT | Cloudflare Worker | ✅ unit |
| TEX | MD | Cloudflare Worker | ✅ unit |
| TEX | PDF | GitHub Actions (`render`) | ✅ runtime-CI |

### Spreadsheets

| Source | Target | Runs on | Verification |
|---|---|---|---|
| XLS | XLSX | GitHub Actions (`office_convert`) | ⚠️ untested |
| XLS | ODS | GitHub Actions (`office_convert`) | ⚠️ untested |
| XLS | CSV | GitHub Actions (`office_convert`) | ⚠️ untested |
| XLS | PDF | GitHub Actions (`office_convert`) | ⚠️ untested |
| XLS | HTML | GitHub Actions (`office_convert`) | ⚠️ untested |
| XLSX | CSV | Cloudflare Worker | ✅ unit |
| XLSX | TSV | Cloudflare Worker | ✅ unit |
| XLSX | JSON | Cloudflare Worker | ✅ unit |
| XLSX | JSONL | Cloudflare Worker | ✅ unit |
| XLSX | XML | Cloudflare Worker | ✅ unit |
| XLSX | YAML | Cloudflare Worker | ✅ unit |
| XLSX | TOML | Cloudflare Worker | ✅ unit |
| XLSX | SQL | Cloudflare Worker | ✅ unit |
| XLSX | ODS | Cloudflare Worker | ✅ unit |
| XLSX | HTML | Cloudflare Worker | ✅ unit |
| XLSX | MD | Cloudflare Worker | ✅ unit |
| XLSX | PDF | Cloudflare Worker | ✅ unit |
| XLSX | DOCX | Cloudflare Worker | ✅ unit |
| XLSX | XLS | GitHub Actions (`office_convert`) | ⚠️ untested |
| CSV | TSV | Cloudflare Worker | ✅ unit |
| CSV | JSON | Cloudflare Worker | ✅ live, ✅ unit |
| CSV | JSONL | Cloudflare Worker | ✅ unit |
| CSV | XML | Cloudflare Worker | ✅ unit |
| CSV | YAML | Cloudflare Worker | ✅ unit |
| CSV | TOML | Cloudflare Worker | ✅ unit |
| CSV | SQL | Cloudflare Worker | ✅ unit |
| CSV | XLSX | Cloudflare Worker | ✅ unit, ✅ runtime-CI |
| CSV | ODS | Cloudflare Worker | ✅ unit, ✅ runtime-CI |
| CSV | HTML | Cloudflare Worker | ✅ unit |
| CSV | MD | Cloudflare Worker | ✅ unit |
| CSV | PDF | Cloudflare Worker | ✅ unit |
| CSV | DOCX | Cloudflare Worker | ✅ unit |
| CSV | PARQUET | GitHub Actions (`data_convert`) | ⚠️ untested |
| CSV | AVRO | GitHub Actions (`data_convert`) | ⚠️ untested |
| CSV | SQLITE | GitHub Actions (`data_convert`) | ⚠️ untested |
| ODS | CSV | Cloudflare Worker | ✅ unit |
| ODS | TSV | Cloudflare Worker | ✅ unit |
| ODS | JSON | Cloudflare Worker | ✅ unit |
| ODS | JSONL | Cloudflare Worker | ✅ unit |
| ODS | XML | Cloudflare Worker | ✅ unit |
| ODS | YAML | Cloudflare Worker | ✅ unit |
| ODS | TOML | Cloudflare Worker | ✅ unit |
| ODS | SQL | Cloudflare Worker | ✅ unit |
| ODS | XLSX | Cloudflare Worker | ✅ unit |
| ODS | HTML | Cloudflare Worker | ✅ unit |
| ODS | MD | Cloudflare Worker | ✅ unit |
| ODS | PDF | Cloudflare Worker | ✅ unit |
| ODS | DOCX | Cloudflare Worker | ✅ unit |
| ODS | XLS | GitHub Actions (`office_convert`) | ⚠️ untested |
| TSV | CSV | Cloudflare Worker | ✅ unit |
| TSV | JSON | Cloudflare Worker | ✅ unit |
| TSV | JSONL | Cloudflare Worker | ✅ unit |
| TSV | XML | Cloudflare Worker | ✅ unit |
| TSV | YAML | Cloudflare Worker | ✅ unit |
| TSV | TOML | Cloudflare Worker | ✅ unit |
| TSV | SQL | Cloudflare Worker | ✅ unit |
| TSV | XLSX | Cloudflare Worker | ✅ unit |
| TSV | ODS | Cloudflare Worker | ✅ unit |
| TSV | HTML | Cloudflare Worker | ✅ unit |
| TSV | MD | Cloudflare Worker | ✅ unit |
| TSV | PDF | Cloudflare Worker | ✅ unit |
| TSV | DOCX | Cloudflare Worker | ✅ unit |

### Data & databases

| Source | Target | Runs on | Verification |
|---|---|---|---|
| JSON | CSV | Cloudflare Worker | ✅ unit |
| JSON | TSV | Cloudflare Worker | ✅ unit |
| JSON | JSONL | Cloudflare Worker | ✅ unit |
| JSON | XML | Cloudflare Worker | ✅ unit |
| JSON | YAML | Cloudflare Worker | ✅ unit |
| JSON | TOML | Cloudflare Worker | ✅ unit |
| JSON | SQL | Cloudflare Worker | ✅ unit |
| JSON | XLSX | Cloudflare Worker | ✅ unit |
| JSON | ODS | Cloudflare Worker | ✅ unit |
| JSON | HTML | Cloudflare Worker | ✅ unit |
| JSON | MD | Cloudflare Worker | ✅ unit |
| JSON | PDF | Cloudflare Worker | ✅ unit |
| JSON | DOCX | Cloudflare Worker | ✅ unit |
| JSON | INI | Cloudflare Worker | ✅ unit |
| JSON | PROPERTIES | Cloudflare Worker | ✅ unit |
| JSON | ENV | Cloudflare Worker | ✅ unit |
| JSON | PARQUET | GitHub Actions (`data_convert`) | ⚠️ untested |
| JSON | AVRO | GitHub Actions (`data_convert`) | ⚠️ untested |
| JSON | SQLITE | GitHub Actions (`data_convert`) | ⚠️ untested |
| JSONL | CSV | Cloudflare Worker | ✅ unit |
| JSONL | TSV | Cloudflare Worker | ✅ unit |
| JSONL | JSON | Cloudflare Worker | ✅ unit |
| JSONL | XML | Cloudflare Worker | ✅ unit |
| JSONL | YAML | Cloudflare Worker | ✅ unit |
| JSONL | TOML | Cloudflare Worker | ✅ unit |
| JSONL | SQL | Cloudflare Worker | ✅ unit |
| JSONL | XLSX | Cloudflare Worker | ✅ unit |
| JSONL | ODS | Cloudflare Worker | ✅ unit |
| JSONL | HTML | Cloudflare Worker | ✅ unit |
| JSONL | MD | Cloudflare Worker | ✅ unit |
| JSONL | PDF | Cloudflare Worker | ✅ unit |
| JSONL | DOCX | Cloudflare Worker | ✅ unit |
| XML | CSV | Cloudflare Worker | ✅ unit |
| XML | TSV | Cloudflare Worker | ✅ unit |
| XML | JSON | Cloudflare Worker | ✅ unit |
| XML | YAML | Cloudflare Worker | ✅ unit |
| XML | TOML | Cloudflare Worker | ✅ unit |
| XML | SQL | Cloudflare Worker | ✅ unit |
| XML | XLSX | Cloudflare Worker | ✅ unit |
| XML | ODS | Cloudflare Worker | ✅ unit |
| XML | HTML | Cloudflare Worker | ✅ unit |
| XML | MD | Cloudflare Worker | ✅ unit |
| XML | PDF | Cloudflare Worker | ✅ unit |
| XML | DOCX | Cloudflare Worker | ✅ unit |
| XML | YAML | Cloudflare Worker | ✅ unit |
| XML | TOML | Cloudflare Worker | ✅ unit |
| SQL | CSV | Cloudflare Worker | ✅ unit |
| SQL | JSON | Cloudflare Worker | ✅ unit |
| SQL | XLSX | Cloudflare Worker | ✅ unit |
| SQL | TXT | Cloudflare Worker | ✅ unit |
| SQL | MD | Cloudflare Worker | ✅ unit |
| SQL | HTML | Cloudflare Worker | ✅ unit |
| SQL | PDF | Cloudflare Worker | ✅ unit |
| SQLITE | CSV | GitHub Actions (`data_convert`) | ✅ runtime-CI |
| SQLITE | JSON | GitHub Actions (`data_convert`) | ✅ runtime-CI |
| SQLITE | PARQUET | GitHub Actions (`data_convert`) | ✅ runtime-CI |
| SQLITE | AVRO | GitHub Actions (`data_convert`) | ✅ runtime-CI |
| PARQUET | CSV | GitHub Actions (`data_convert`) | ⚠️ untested |
| PARQUET | JSON | GitHub Actions (`data_convert`) | ✅ runtime-CI |
| PARQUET | AVRO | GitHub Actions (`data_convert`) | ⚠️ untested |
| PARQUET | SQLITE | GitHub Actions (`data_convert`) | ⚠️ untested |
| AVRO | CSV | GitHub Actions (`data_convert`) | ⚠️ untested |
| AVRO | JSON | GitHub Actions (`data_convert`) | ✅ runtime-CI |
| AVRO | PARQUET | GitHub Actions (`data_convert`) | ⚠️ untested |
| AVRO | SQLITE | GitHub Actions (`data_convert`) | ⚠️ untested |

### Presentations

| Source | Target | Runs on | Verification |
|---|---|---|---|
| PPT | PPTX | GitHub Actions (`office_convert`) | ⚠️ untested |
| PPT | ODP | GitHub Actions (`office_convert`) | ⚠️ untested |
| PPT | PDF | GitHub Actions (`office_convert`) | ⚠️ untested |
| PPTX | TXT | Cloudflare Worker | ✅ unit |
| PPTX | MD | Cloudflare Worker | ✅ unit |
| PPTX | HTML | Cloudflare Worker | ✅ unit |
| PPTX | DOCX | Cloudflare Worker | ✅ unit |
| PPTX | PDF | GitHub Actions (`office_convert`) | ⚠️ untested |
| PPTX | ODP | GitHub Actions (`office_convert`) | ⚠️ untested |
| PPTX | PPT | GitHub Actions (`office_convert`) | ⚠️ untested |
| ODP | TXT | Cloudflare Worker | ✅ unit |
| ODP | MD | Cloudflare Worker | ✅ unit |
| ODP | HTML | Cloudflare Worker | ✅ unit |
| ODP | DOCX | Cloudflare Worker | ✅ unit |
| ODP | PDF | GitHub Actions (`office_convert`) | ⚠️ untested |
| ODP | PPTX | GitHub Actions (`office_convert`) | ⚠️ untested |
| ODP | PPT | GitHub Actions (`office_convert`) | ⚠️ untested |

### Code / development

| Source | Target | Runs on | Verification |
|---|---|---|---|
| CSS | TXT | Cloudflare Worker | ✅ unit |
| CSS | MD | Cloudflare Worker | ✅ unit |
| CSS | HTML | Cloudflare Worker | ✅ unit |
| CSS | PDF | Cloudflare Worker | ✅ unit |
| CSS | DOCX | Cloudflare Worker | ✅ unit |
| JS | TXT | Cloudflare Worker | ✅ unit |
| JS | MD | Cloudflare Worker | ✅ unit |
| JS | HTML | Cloudflare Worker | ✅ unit |
| JS | PDF | Cloudflare Worker | ✅ unit |
| JS | DOCX | Cloudflare Worker | ✅ unit |
| JSX | TXT | Cloudflare Worker | ✅ unit |
| JSX | MD | Cloudflare Worker | ✅ unit |
| JSX | HTML | Cloudflare Worker | ✅ unit |
| JSX | PDF | Cloudflare Worker | ✅ unit |
| JSX | DOCX | Cloudflare Worker | ✅ unit |
| TS | TXT | Cloudflare Worker | ✅ unit |
| TS | MD | Cloudflare Worker | ✅ unit |
| TS | HTML | Cloudflare Worker | ✅ unit |
| TS | PDF | Cloudflare Worker | ✅ unit |
| TS | DOCX | Cloudflare Worker | ✅ unit |
| TSX | TXT | Cloudflare Worker | ✅ unit |
| TSX | MD | Cloudflare Worker | ✅ unit |
| TSX | HTML | Cloudflare Worker | ✅ unit |
| TSX | PDF | Cloudflare Worker | ✅ unit |
| TSX | DOCX | Cloudflare Worker | ✅ unit |
| MJS | TXT | Cloudflare Worker | ✅ unit |
| MJS | MD | Cloudflare Worker | ✅ unit |
| MJS | HTML | Cloudflare Worker | ✅ unit |
| MJS | PDF | Cloudflare Worker | ✅ unit |
| MJS | DOCX | Cloudflare Worker | ✅ unit |
| CJS | TXT | Cloudflare Worker | ✅ unit |
| CJS | MD | Cloudflare Worker | ✅ unit |
| CJS | HTML | Cloudflare Worker | ✅ unit |
| CJS | PDF | Cloudflare Worker | ✅ unit |
| CJS | DOCX | Cloudflare Worker | ✅ unit |
| PY | TXT | Cloudflare Worker | ✅ unit |
| PY | MD | Cloudflare Worker | ✅ unit |
| PY | HTML | Cloudflare Worker | ✅ unit |
| PY | PDF | Cloudflare Worker | ✅ unit |
| PY | DOCX | Cloudflare Worker | ✅ unit |
| JAVA | TXT | Cloudflare Worker | ✅ unit |
| JAVA | MD | Cloudflare Worker | ✅ unit |
| JAVA | HTML | Cloudflare Worker | ✅ unit |
| JAVA | PDF | Cloudflare Worker | ✅ unit |
| JAVA | DOCX | Cloudflare Worker | ✅ unit |
| C | TXT | Cloudflare Worker | ✅ unit |
| C | MD | Cloudflare Worker | ✅ unit |
| C | HTML | Cloudflare Worker | ✅ unit |
| C | PDF | Cloudflare Worker | ✅ unit |
| C | DOCX | Cloudflare Worker | ✅ unit |
| CPP | TXT | Cloudflare Worker | ✅ unit |
| CPP | MD | Cloudflare Worker | ✅ unit |
| CPP | HTML | Cloudflare Worker | ✅ unit |
| CPP | PDF | Cloudflare Worker | ✅ unit |
| CPP | DOCX | Cloudflare Worker | ✅ unit |
| H | TXT | Cloudflare Worker | ✅ unit |
| H | MD | Cloudflare Worker | ✅ unit |
| H | HTML | Cloudflare Worker | ✅ unit |
| H | PDF | Cloudflare Worker | ✅ unit |
| H | DOCX | Cloudflare Worker | ✅ unit |
| HPP | TXT | Cloudflare Worker | ✅ unit |
| HPP | MD | Cloudflare Worker | ✅ unit |
| HPP | HTML | Cloudflare Worker | ✅ unit |
| HPP | PDF | Cloudflare Worker | ✅ unit |
| HPP | DOCX | Cloudflare Worker | ✅ unit |
| CS | TXT | Cloudflare Worker | ✅ unit |
| CS | MD | Cloudflare Worker | ✅ unit |
| CS | HTML | Cloudflare Worker | ✅ unit |
| CS | PDF | Cloudflare Worker | ✅ unit |
| CS | DOCX | Cloudflare Worker | ✅ unit |
| GO | TXT | Cloudflare Worker | ✅ unit |
| GO | MD | Cloudflare Worker | ✅ unit |
| GO | HTML | Cloudflare Worker | ✅ unit |
| GO | PDF | Cloudflare Worker | ✅ unit |
| GO | DOCX | Cloudflare Worker | ✅ unit |
| RS | TXT | Cloudflare Worker | ✅ unit |
| RS | MD | Cloudflare Worker | ✅ unit |
| RS | HTML | Cloudflare Worker | ✅ unit |
| RS | PDF | Cloudflare Worker | ✅ unit |
| RS | DOCX | Cloudflare Worker | ✅ unit |
| PHP | TXT | Cloudflare Worker | ✅ unit |
| PHP | MD | Cloudflare Worker | ✅ unit |
| PHP | HTML | Cloudflare Worker | ✅ unit |
| PHP | PDF | Cloudflare Worker | ✅ unit |
| PHP | DOCX | Cloudflare Worker | ✅ unit |
| RB | TXT | Cloudflare Worker | ✅ unit |
| RB | MD | Cloudflare Worker | ✅ unit |
| RB | HTML | Cloudflare Worker | ✅ unit |
| RB | PDF | Cloudflare Worker | ✅ unit |
| RB | DOCX | Cloudflare Worker | ✅ unit |
| SWIFT | TXT | Cloudflare Worker | ✅ unit |
| SWIFT | MD | Cloudflare Worker | ✅ unit |
| SWIFT | HTML | Cloudflare Worker | ✅ unit |
| SWIFT | PDF | Cloudflare Worker | ✅ unit |
| SWIFT | DOCX | Cloudflare Worker | ✅ unit |
| KT | TXT | Cloudflare Worker | ✅ unit |
| KT | MD | Cloudflare Worker | ✅ unit |
| KT | HTML | Cloudflare Worker | ✅ unit |
| KT | PDF | Cloudflare Worker | ✅ unit |
| KT | DOCX | Cloudflare Worker | ✅ unit |
| KTS | TXT | Cloudflare Worker | ✅ unit |
| KTS | MD | Cloudflare Worker | ✅ unit |
| KTS | HTML | Cloudflare Worker | ✅ unit |
| KTS | PDF | Cloudflare Worker | ✅ unit |
| KTS | DOCX | Cloudflare Worker | ✅ unit |
| SH | TXT | Cloudflare Worker | ✅ unit |
| SH | MD | Cloudflare Worker | ✅ unit |
| SH | HTML | Cloudflare Worker | ✅ unit |
| SH | PDF | Cloudflare Worker | ✅ unit |
| SH | DOCX | Cloudflare Worker | ✅ unit |
| BAT | TXT | Cloudflare Worker | ✅ unit |
| BAT | MD | Cloudflare Worker | ✅ unit |
| BAT | HTML | Cloudflare Worker | ✅ unit |
| BAT | PDF | Cloudflare Worker | ✅ unit |
| BAT | DOCX | Cloudflare Worker | ✅ unit |
| PS1 | TXT | Cloudflare Worker | ✅ unit |
| PS1 | MD | Cloudflare Worker | ✅ unit |
| PS1 | HTML | Cloudflare Worker | ✅ unit |
| PS1 | PDF | Cloudflare Worker | ✅ unit |
| PS1 | DOCX | Cloudflare Worker | ✅ unit |
| IPYNB | PY | Cloudflare Worker | ✅ unit |
| IPYNB | MD | Cloudflare Worker | ✅ unit |
| IPYNB | HTML | Cloudflare Worker | ✅ unit |
| IPYNB | TXT | Cloudflare Worker | ✅ unit |
| IPYNB | PDF | Cloudflare Worker | ✅ unit |
| IPYNB | JSON | Cloudflare Worker | ✅ unit |

### Configuration

| Source | Target | Runs on | Verification |
|---|---|---|---|
| YAML | CSV | Cloudflare Worker | ✅ unit |
| YAML | TSV | Cloudflare Worker | ✅ unit |
| YAML | JSON | Cloudflare Worker | ✅ unit |
| YAML | JSONL | Cloudflare Worker | ✅ unit |
| YAML | XML | Cloudflare Worker | ✅ unit |
| YAML | TOML | Cloudflare Worker | ✅ unit |
| YAML | SQL | Cloudflare Worker | ✅ unit |
| YAML | XLSX | Cloudflare Worker | ✅ unit |
| YAML | ODS | Cloudflare Worker | ✅ unit |
| YAML | HTML | Cloudflare Worker | ✅ unit |
| YAML | MD | Cloudflare Worker | ✅ unit |
| YAML | PDF | Cloudflare Worker | ✅ unit |
| YAML | DOCX | Cloudflare Worker | ✅ unit |
| YAML | JSON | Cloudflare Worker | ✅ unit |
| YAML | TOML | Cloudflare Worker | ✅ unit |
| YAML | XML | Cloudflare Worker | ✅ unit |
| TOML | JSON | Cloudflare Worker | ✅ unit |
| TOML | YAML | Cloudflare Worker | ✅ unit |
| TOML | XML | Cloudflare Worker | ✅ unit |
| TOML | CSV | Cloudflare Worker | ✅ unit |
| TOML | XLSX | Cloudflare Worker | ✅ unit |
| TOML | INI | Cloudflare Worker | ✅ unit |
| ENV | JSON | Cloudflare Worker | ✅ unit |
| ENV | YAML | Cloudflare Worker | ✅ unit |
| ENV | PROPERTIES | Cloudflare Worker | ✅ unit |
| ENV | INI | Cloudflare Worker | ✅ unit |
| ENV | TOML | Cloudflare Worker | ✅ unit |
| INI | JSON | Cloudflare Worker | ✅ unit |
| INI | YAML | Cloudflare Worker | ✅ unit |
| INI | TOML | Cloudflare Worker | ✅ unit |
| INI | PROPERTIES | Cloudflare Worker | ✅ unit |
| INI | ENV | Cloudflare Worker | ✅ unit |
| CFG | JSON | Cloudflare Worker | ✅ unit |
| CFG | YAML | Cloudflare Worker | ✅ unit |
| CFG | TOML | Cloudflare Worker | ✅ unit |
| CFG | INI | Cloudflare Worker | ✅ unit |
| CONF | JSON | Cloudflare Worker | ✅ unit |
| CONF | YAML | Cloudflare Worker | ✅ unit |
| CONF | TOML | Cloudflare Worker | ✅ unit |
| CONF | INI | Cloudflare Worker | ✅ unit |
| PROPERTIES | JSON | Cloudflare Worker | ✅ unit |
| PROPERTIES | YAML | Cloudflare Worker | ✅ unit |
| PROPERTIES | ENV | Cloudflare Worker | ✅ unit |
| PROPERTIES | INI | Cloudflare Worker | ✅ unit |
| PROPERTIES | TOML | Cloudflare Worker | ✅ unit |
| DOCKERFILE | TXT | Cloudflare Worker | ✅ unit |
| DOCKERFILE | MD | Cloudflare Worker | ✅ unit |
| DOCKERFILE | HTML | Cloudflare Worker | ✅ unit |
| DOCKERFILE | PDF | Cloudflare Worker | ✅ unit |
| DOCKERFILE | DOCX | Cloudflare Worker | ✅ unit |
| DOCKERFILE | JSON | Cloudflare Worker | ✅ unit |
| GITIGNORE | TXT | Cloudflare Worker | ✅ unit |
| GITIGNORE | MD | Cloudflare Worker | ✅ unit |
| GITIGNORE | HTML | Cloudflare Worker | ✅ unit |
| GITIGNORE | PDF | Cloudflare Worker | ✅ unit |
| GITIGNORE | DOCX | Cloudflare Worker | ✅ unit |
| GITIGNORE | JSON | Cloudflare Worker | ✅ unit |

### Images

| Source | Target | Runs on | Verification |
|---|---|---|---|
| PNG | JPEG | GitHub Actions (`image_convert`) | ✅ runtime-CI |
| PNG | WEBP | GitHub Actions (`image_convert`) | ✅ runtime-CI |
| PNG | GIF | GitHub Actions (`image_convert`) | ✅ runtime-CI |
| PNG | BMP | GitHub Actions (`image_convert`) | ✅ runtime-CI |
| PNG | TIFF | GitHub Actions (`image_convert`) | ✅ runtime-CI |
| PNG | ICO | GitHub Actions (`image_convert`) | ⚠️ untested |
| PNG | AVIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| PNG | PDF | GitHub Actions (`image_convert`) | ⚠️ untested |
| JPEG | PNG | GitHub Actions (`image_convert`) | ✅ runtime-CI |
| JPEG | WEBP | GitHub Actions (`image_convert`) | ⚠️ untested |
| JPEG | GIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| JPEG | BMP | GitHub Actions (`image_convert`) | ⚠️ untested |
| JPEG | TIFF | GitHub Actions (`image_convert`) | ⚠️ untested |
| JPEG | ICO | GitHub Actions (`image_convert`) | ⚠️ untested |
| JPEG | AVIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| JPEG | PDF | GitHub Actions (`image_convert`) | ⚠️ untested |
| WEBP | PNG | GitHub Actions (`image_convert`) | ⚠️ untested |
| WEBP | JPEG | GitHub Actions (`image_convert`) | ⚠️ untested |
| WEBP | GIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| WEBP | BMP | GitHub Actions (`image_convert`) | ⚠️ untested |
| WEBP | TIFF | GitHub Actions (`image_convert`) | ⚠️ untested |
| WEBP | ICO | GitHub Actions (`image_convert`) | ⚠️ untested |
| WEBP | AVIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| WEBP | PDF | GitHub Actions (`image_convert`) | ⚠️ untested |
| BMP | PNG | GitHub Actions (`image_convert`) | ⚠️ untested |
| BMP | JPEG | GitHub Actions (`image_convert`) | ⚠️ untested |
| BMP | WEBP | GitHub Actions (`image_convert`) | ⚠️ untested |
| BMP | GIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| BMP | TIFF | GitHub Actions (`image_convert`) | ⚠️ untested |
| BMP | ICO | GitHub Actions (`image_convert`) | ⚠️ untested |
| BMP | AVIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| BMP | PDF | GitHub Actions (`image_convert`) | ⚠️ untested |
| TIFF | PNG | GitHub Actions (`image_convert`) | ⚠️ untested |
| TIFF | JPEG | GitHub Actions (`image_convert`) | ⚠️ untested |
| TIFF | WEBP | GitHub Actions (`image_convert`) | ⚠️ untested |
| TIFF | GIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| TIFF | BMP | GitHub Actions (`image_convert`) | ⚠️ untested |
| TIFF | ICO | GitHub Actions (`image_convert`) | ⚠️ untested |
| TIFF | AVIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| TIFF | PDF | GitHub Actions (`image_convert`) | ⚠️ untested |
| GIF | PNG | GitHub Actions (`image_convert`) | ⚠️ untested |
| GIF | JPEG | GitHub Actions (`image_convert`) | ⚠️ untested |
| GIF | WEBP | GitHub Actions (`image_convert`) | ⚠️ untested |
| GIF | BMP | GitHub Actions (`image_convert`) | ⚠️ untested |
| GIF | TIFF | GitHub Actions (`image_convert`) | ⚠️ untested |
| GIF | ICO | GitHub Actions (`image_convert`) | ⚠️ untested |
| GIF | AVIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| GIF | PDF | GitHub Actions (`image_convert`) | ⚠️ untested |
| ICO | PNG | GitHub Actions (`image_convert`) | ⚠️ untested |
| ICO | JPEG | GitHub Actions (`image_convert`) | ⚠️ untested |
| ICO | WEBP | GitHub Actions (`image_convert`) | ⚠️ untested |
| ICO | GIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| ICO | BMP | GitHub Actions (`image_convert`) | ⚠️ untested |
| ICO | TIFF | GitHub Actions (`image_convert`) | ⚠️ untested |
| ICO | AVIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| ICO | PDF | GitHub Actions (`image_convert`) | ⚠️ untested |
| AVIF | PNG | GitHub Actions (`image_convert`) | ⚠️ untested |
| AVIF | JPEG | GitHub Actions (`image_convert`) | ⚠️ untested |
| AVIF | WEBP | GitHub Actions (`image_convert`) | ⚠️ untested |
| AVIF | GIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| AVIF | BMP | GitHub Actions (`image_convert`) | ⚠️ untested |
| AVIF | TIFF | GitHub Actions (`image_convert`) | ⚠️ untested |
| AVIF | ICO | GitHub Actions (`image_convert`) | ⚠️ untested |
| AVIF | PDF | GitHub Actions (`image_convert`) | ⚠️ untested |
| HEIC | PNG | GitHub Actions (`image_convert`) | ⚠️ untested |
| HEIC | JPEG | GitHub Actions (`image_convert`) | ⚠️ untested |
| HEIC | WEBP | GitHub Actions (`image_convert`) | ⚠️ untested |
| HEIC | GIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| HEIC | BMP | GitHub Actions (`image_convert`) | ⚠️ untested |
| HEIC | TIFF | GitHub Actions (`image_convert`) | ⚠️ untested |
| HEIC | ICO | GitHub Actions (`image_convert`) | ⚠️ untested |
| HEIC | AVIF | GitHub Actions (`image_convert`) | ⚠️ untested |
| HEIC | PDF | GitHub Actions (`image_convert`) | ⚠️ untested |
| SVG | TXT | Cloudflare Worker | ✅ unit |
| SVG | PNG | GitHub Actions (`render`) | ✅ runtime-CI |
| SVG | PDF | GitHub Actions (`render`) | ⚠️ untested |

### Audio

| Source | Target | Runs on | Verification |
|---|---|---|---|
| WAV | MP3 | GitHub Actions (`audio_convert`) | ✅ live, ✅ runtime-CI |
| WAV | FLAC | GitHub Actions (`audio_convert`) | ✅ runtime-CI |
| WAV | OGG | GitHub Actions (`audio_convert`) | ✅ runtime-CI |
| WAV | OPUS | GitHub Actions (`audio_convert`) | ✅ runtime-CI |
| WAV | M4A | GitHub Actions (`audio_convert`) | ✅ runtime-CI |
| WAV | AAC | GitHub Actions (`audio_convert`) | ✅ runtime-CI |
| WAV | AIFF | GitHub Actions (`audio_convert`) | ✅ runtime-CI |
| WAV | WMA | GitHub Actions (`audio_convert`) | ✅ runtime-CI |
| MP3 | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP3 | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP3 | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP3 | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP3 | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP3 | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP3 | AIFF | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP3 | WMA | GitHub Actions (`audio_convert`) | ⚠️ untested |
| FLAC | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| FLAC | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| FLAC | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| FLAC | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| FLAC | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| FLAC | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| FLAC | AIFF | GitHub Actions (`audio_convert`) | ⚠️ untested |
| FLAC | WMA | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OGG | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OGG | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OGG | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OGG | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OGG | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OGG | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OGG | AIFF | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OGG | WMA | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4A | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4A | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4A | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4A | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4A | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4A | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4A | AIFF | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4A | WMA | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AAC | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AAC | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AAC | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AAC | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AAC | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AAC | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AAC | AIFF | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AAC | WMA | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMA | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMA | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMA | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMA | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMA | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMA | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMA | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMA | AIFF | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OPUS | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OPUS | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OPUS | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OPUS | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OPUS | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OPUS | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OPUS | AIFF | GitHub Actions (`audio_convert`) | ⚠️ untested |
| OPUS | WMA | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AIFF | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AIFF | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AIFF | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AIFF | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AIFF | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AIFF | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AIFF | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AIFF | WMA | GitHub Actions (`audio_convert`) | ⚠️ untested |

### Video

| Source | Target | Runs on | Verification |
|---|---|---|---|
| MP4 | WEBM | GitHub Actions (`video_convert`) | ✅ runtime-CI |
| MP4 | MOV | GitHub Actions (`video_convert`) | ✅ runtime-CI |
| MP4 | MKV | GitHub Actions (`video_convert`) | ✅ runtime-CI |
| MP4 | M4V | GitHub Actions (`video_convert`) | ✅ runtime-CI |
| MP4 | AVI | GitHub Actions (`video_convert`) | ✅ runtime-CI |
| MP4 | WMV | GitHub Actions (`video_convert`) | ✅ runtime-CI |
| MP4 | MPEG | GitHub Actions (`video_convert`) | ✅ runtime-CI |
| MP4 | 3GP | GitHub Actions (`video_convert`) | ✅ runtime-CI |
| MP4 | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP4 | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP4 | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP4 | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP4 | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP4 | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MP4 | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WEBM | MP4 | GitHub Actions (`video_convert`) | ⚠️ untested |
| WEBM | MOV | GitHub Actions (`video_convert`) | ⚠️ untested |
| WEBM | MKV | GitHub Actions (`video_convert`) | ⚠️ untested |
| WEBM | M4V | GitHub Actions (`video_convert`) | ⚠️ untested |
| WEBM | AVI | GitHub Actions (`video_convert`) | ⚠️ untested |
| WEBM | WMV | GitHub Actions (`video_convert`) | ⚠️ untested |
| WEBM | MPEG | GitHub Actions (`video_convert`) | ⚠️ untested |
| WEBM | 3GP | GitHub Actions (`video_convert`) | ⚠️ untested |
| WEBM | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WEBM | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WEBM | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WEBM | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WEBM | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WEBM | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WEBM | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MOV | MP4 | GitHub Actions (`video_convert`) | ⚠️ untested |
| MOV | WEBM | GitHub Actions (`video_convert`) | ⚠️ untested |
| MOV | MKV | GitHub Actions (`video_convert`) | ⚠️ untested |
| MOV | M4V | GitHub Actions (`video_convert`) | ⚠️ untested |
| MOV | AVI | GitHub Actions (`video_convert`) | ⚠️ untested |
| MOV | WMV | GitHub Actions (`video_convert`) | ⚠️ untested |
| MOV | MPEG | GitHub Actions (`video_convert`) | ⚠️ untested |
| MOV | 3GP | GitHub Actions (`video_convert`) | ⚠️ untested |
| MOV | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MOV | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MOV | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MOV | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MOV | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MOV | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MOV | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MKV | MP4 | GitHub Actions (`video_convert`) | ⚠️ untested |
| MKV | WEBM | GitHub Actions (`video_convert`) | ⚠️ untested |
| MKV | MOV | GitHub Actions (`video_convert`) | ⚠️ untested |
| MKV | M4V | GitHub Actions (`video_convert`) | ⚠️ untested |
| MKV | AVI | GitHub Actions (`video_convert`) | ⚠️ untested |
| MKV | WMV | GitHub Actions (`video_convert`) | ⚠️ untested |
| MKV | MPEG | GitHub Actions (`video_convert`) | ⚠️ untested |
| MKV | 3GP | GitHub Actions (`video_convert`) | ⚠️ untested |
| MKV | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MKV | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MKV | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MKV | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MKV | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MKV | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MKV | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AVI | MP4 | GitHub Actions (`video_convert`) | ⚠️ untested |
| AVI | WEBM | GitHub Actions (`video_convert`) | ⚠️ untested |
| AVI | MOV | GitHub Actions (`video_convert`) | ⚠️ untested |
| AVI | MKV | GitHub Actions (`video_convert`) | ⚠️ untested |
| AVI | M4V | GitHub Actions (`video_convert`) | ⚠️ untested |
| AVI | WMV | GitHub Actions (`video_convert`) | ⚠️ untested |
| AVI | MPEG | GitHub Actions (`video_convert`) | ⚠️ untested |
| AVI | 3GP | GitHub Actions (`video_convert`) | ⚠️ untested |
| AVI | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AVI | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AVI | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AVI | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AVI | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AVI | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| AVI | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMV | MP4 | GitHub Actions (`video_convert`) | ⚠️ untested |
| WMV | WEBM | GitHub Actions (`video_convert`) | ⚠️ untested |
| WMV | MOV | GitHub Actions (`video_convert`) | ⚠️ untested |
| WMV | MKV | GitHub Actions (`video_convert`) | ⚠️ untested |
| WMV | M4V | GitHub Actions (`video_convert`) | ⚠️ untested |
| WMV | AVI | GitHub Actions (`video_convert`) | ⚠️ untested |
| WMV | MPEG | GitHub Actions (`video_convert`) | ⚠️ untested |
| WMV | 3GP | GitHub Actions (`video_convert`) | ⚠️ untested |
| WMV | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMV | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMV | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMV | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMV | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMV | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| WMV | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4V | MP4 | GitHub Actions (`video_convert`) | ⚠️ untested |
| M4V | WEBM | GitHub Actions (`video_convert`) | ⚠️ untested |
| M4V | MOV | GitHub Actions (`video_convert`) | ⚠️ untested |
| M4V | MKV | GitHub Actions (`video_convert`) | ⚠️ untested |
| M4V | AVI | GitHub Actions (`video_convert`) | ⚠️ untested |
| M4V | WMV | GitHub Actions (`video_convert`) | ⚠️ untested |
| M4V | MPEG | GitHub Actions (`video_convert`) | ⚠️ untested |
| M4V | 3GP | GitHub Actions (`video_convert`) | ⚠️ untested |
| M4V | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4V | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4V | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4V | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4V | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4V | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| M4V | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MPEG | MP4 | GitHub Actions (`video_convert`) | ⚠️ untested |
| MPEG | WEBM | GitHub Actions (`video_convert`) | ⚠️ untested |
| MPEG | MOV | GitHub Actions (`video_convert`) | ⚠️ untested |
| MPEG | MKV | GitHub Actions (`video_convert`) | ⚠️ untested |
| MPEG | M4V | GitHub Actions (`video_convert`) | ⚠️ untested |
| MPEG | AVI | GitHub Actions (`video_convert`) | ⚠️ untested |
| MPEG | WMV | GitHub Actions (`video_convert`) | ⚠️ untested |
| MPEG | 3GP | GitHub Actions (`video_convert`) | ⚠️ untested |
| MPEG | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MPEG | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MPEG | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MPEG | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MPEG | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MPEG | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| MPEG | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| 3GP | MP4 | GitHub Actions (`video_convert`) | ⚠️ untested |
| 3GP | WEBM | GitHub Actions (`video_convert`) | ⚠️ untested |
| 3GP | MOV | GitHub Actions (`video_convert`) | ⚠️ untested |
| 3GP | MKV | GitHub Actions (`video_convert`) | ⚠️ untested |
| 3GP | M4V | GitHub Actions (`video_convert`) | ⚠️ untested |
| 3GP | AVI | GitHub Actions (`video_convert`) | ⚠️ untested |
| 3GP | WMV | GitHub Actions (`video_convert`) | ⚠️ untested |
| 3GP | MPEG | GitHub Actions (`video_convert`) | ⚠️ untested |
| 3GP | MP3 | GitHub Actions (`audio_convert`) | ⚠️ untested |
| 3GP | WAV | GitHub Actions (`audio_convert`) | ⚠️ untested |
| 3GP | FLAC | GitHub Actions (`audio_convert`) | ⚠️ untested |
| 3GP | OGG | GitHub Actions (`audio_convert`) | ⚠️ untested |
| 3GP | OPUS | GitHub Actions (`audio_convert`) | ⚠️ untested |
| 3GP | M4A | GitHub Actions (`audio_convert`) | ⚠️ untested |
| 3GP | AAC | GitHub Actions (`audio_convert`) | ⚠️ untested |

### Archives

| Source | Target | Runs on | Verification |
|---|---|---|---|
| ZIP | TAR | Cloudflare Worker | ✅ unit |
| ZIP | TGZ | Cloudflare Worker | ✅ unit |
| ZIP | TXT | Cloudflare Worker | ✅ unit |
| ZIP | 7Z | GitHub Actions (`archive_convert`) | ⚠️ untested |
| TAR | ZIP | Cloudflare Worker | ✅ unit |
| TAR | TGZ | Cloudflare Worker | ✅ unit |
| TAR | TXT | Cloudflare Worker | ✅ unit |
| TAR | 7Z | GitHub Actions (`archive_convert`) | ⚠️ untested |
| GZ | ZIP | Cloudflare Worker | ✅ unit |
| GZ | TXT | Cloudflare Worker | ✅ unit |
| TGZ | ZIP | Cloudflare Worker | ✅ unit |
| TGZ | TAR | Cloudflare Worker | ✅ unit |
| TGZ | TXT | Cloudflare Worker | ✅ unit |
| TGZ | 7Z | GitHub Actions (`archive_convert`) | ⚠️ untested |
| 7Z | ZIP | GitHub Actions (`archive_convert`) | ✅ runtime-CI |
| 7Z | TAR | GitHub Actions (`archive_convert`) | ⚠️ untested |
| 7Z | TGZ | GitHub Actions (`archive_convert`) | ⚠️ untested |
| RAR | ZIP | GitHub Actions (`archive_convert`) | ⚠️ untested |
| RAR | TAR | GitHub Actions (`archive_convert`) | ⚠️ untested |
| RAR | TGZ | GitHub Actions (`archive_convert`) | ⚠️ untested |
| RAR | 7Z | GitHub Actions (`archive_convert`) | ⚠️ untested |

### Subtitles / transcripts

| Source | Target | Runs on | Verification |
|---|---|---|---|
| SRT | VTT | Cloudflare Worker | ✅ live, ✅ unit |
| SRT | ASS | Cloudflare Worker | ✅ unit |
| SRT | SSA | Cloudflare Worker | ✅ unit |
| SRT | LRC | Cloudflare Worker | ✅ unit |
| SRT | TXT | Cloudflare Worker | ✅ unit |
| SRT | JSON | Cloudflare Worker | ✅ unit |
| VTT | SRT | Cloudflare Worker | ✅ unit |
| VTT | ASS | Cloudflare Worker | ✅ unit |
| VTT | SSA | Cloudflare Worker | ✅ unit |
| VTT | LRC | Cloudflare Worker | ✅ unit |
| VTT | TXT | Cloudflare Worker | ✅ unit |
| VTT | JSON | Cloudflare Worker | ✅ unit |
| ASS | SRT | Cloudflare Worker | ✅ unit |
| ASS | VTT | Cloudflare Worker | ✅ unit |
| ASS | SSA | Cloudflare Worker | ✅ unit |
| ASS | LRC | Cloudflare Worker | ✅ unit |
| ASS | TXT | Cloudflare Worker | ✅ unit |
| ASS | JSON | Cloudflare Worker | ✅ unit |
| SSA | SRT | Cloudflare Worker | ✅ unit |
| SSA | VTT | Cloudflare Worker | ✅ unit |
| SSA | ASS | Cloudflare Worker | ✅ unit |
| SSA | LRC | Cloudflare Worker | ✅ unit |
| SSA | TXT | Cloudflare Worker | ✅ unit |
| SSA | JSON | Cloudflare Worker | ✅ unit |
| LRC | SRT | Cloudflare Worker | ✅ unit |
| LRC | VTT | Cloudflare Worker | ✅ unit |
| LRC | ASS | Cloudflare Worker | ✅ unit |
| LRC | SSA | Cloudflare Worker | ✅ unit |
| LRC | TXT | Cloudflare Worker | ✅ unit |
| LRC | JSON | Cloudflare Worker | ✅ unit |

### E-books / publishing

| Source | Target | Runs on | Verification |
|---|---|---|---|
| EPUB | TXT | Cloudflare Worker | ⚠️ untested |
| EPUB | MD | Cloudflare Worker | ⚠️ untested |
| EPUB | HTML | Cloudflare Worker | ⚠️ untested |
| EPUB | PDF | Cloudflare Worker | ⚠️ untested |
| EPUB | DOCX | Cloudflare Worker | ⚠️ untested |
| EPUB | MOBI | GitHub Actions (`ebook_convert`) | ✅ runtime-CI |
| EPUB | AZW3 | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| EPUB | FB2 | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| MOBI | EPUB | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| MOBI | PDF | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| MOBI | TXT | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| MOBI | AZW3 | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| MOBI | DOCX | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| MOBI | HTML | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| MOBI | FB2 | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| AZW3 | EPUB | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| AZW3 | PDF | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| AZW3 | TXT | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| AZW3 | MOBI | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| AZW3 | DOCX | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| AZW3 | HTML | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| AZW3 | FB2 | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| FB2 | TXT | Cloudflare Worker | ✅ unit |
| FB2 | MD | Cloudflare Worker | ✅ unit |
| FB2 | HTML | Cloudflare Worker | ✅ unit |
| FB2 | PDF | Cloudflare Worker | ✅ unit |
| FB2 | DOCX | Cloudflare Worker | ✅ unit |
| FB2 | EPUB | Cloudflare Worker | ✅ unit |
| FB2 | MOBI | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| FB2 | AZW3 | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| CBZ | PDF | Cloudflare Worker | ✅ unit |
| CBZ | ZIP | Cloudflare Worker | ✅ unit |
| CBZ | EPUB | GitHub Actions (`ebook_convert`) | ⚠️ untested |
| CBR | CBZ | GitHub Actions (`archive_convert`) | ⚠️ untested |
| CBR | ZIP | GitHub Actions (`archive_convert`) | ⚠️ untested |

### Diagrams / graphics

| Source | Target | Runs on | Verification |
|---|---|---|---|
| MMD | MD | Cloudflare Worker | ✅ unit |
| MMD | TXT | Cloudflare Worker | ✅ unit |
| MMD | SVG | GitHub Actions (`render`) | ⚠️ untested |
| MMD | PNG | GitHub Actions (`render`) | ✅ runtime-CI |
| MMD | PDF | GitHub Actions (`render`) | ⚠️ untested |
| DOT | TXT | Cloudflare Worker | ✅ unit |
| DOT | JSON | Cloudflare Worker | ✅ unit |
| DOT | SVG | GitHub Actions (`render`) | ⚠️ untested |
| DOT | PNG | GitHub Actions (`render`) | ✅ runtime-CI |
| DOT | PDF | GitHub Actions (`render`) | ⚠️ untested |
| DRAWIO | JSON | Cloudflare Worker | ✅ unit |
| DRAWIO | TXT | Cloudflare Worker | ✅ unit |
| DRAWIO | DOT | Cloudflare Worker | ✅ unit |
| DRAWIO | MMD | Cloudflare Worker | ✅ unit |
| PUML | TXT | Cloudflare Worker | ✅ unit |
| PUML | MD | Cloudflare Worker | ✅ unit |
| PUML | SVG | GitHub Actions (`render`) | ⚠️ untested |
| PUML | PNG | GitHub Actions (`render`) | ✅ runtime-CI |
| PUML | PDF | GitHub Actions (`render`) | ⚠️ untested |
| DXF | JSON | Cloudflare Worker | ✅ unit |
| DXF | TXT | Cloudflare Worker | ✅ unit |
| DXF | SVG | GitHub Actions (`render`) | ✅ runtime-CI |
| DXF | PNG | GitHub Actions (`render`) | ⚠️ untested |
| DXF | PDF | GitHub Actions (`render`) | ⚠️ untested |

### Fonts

| Source | Target | Runs on | Verification |
|---|---|---|---|
| TTF | WOFF | GitHub Actions (`font_convert`) | ⚠️ untested |
| TTF | WOFF2 | GitHub Actions (`font_convert`) | ✅ runtime-CI |
| OTF | WOFF | GitHub Actions (`font_convert`) | ⚠️ untested |
| OTF | WOFF2 | GitHub Actions (`font_convert`) | ⚠️ untested |
| WOFF | TTF | Cloudflare Worker | ✅ unit |
| WOFF | OTF | Cloudflare Worker | ✅ unit |
| WOFF | WOFF2 | GitHub Actions (`font_convert`) | ⚠️ untested |
| WOFF2 | TTF | GitHub Actions (`font_convert`) | ⚠️ untested |
| WOFF2 | OTF | GitHub Actions (`font_convert`) | ⚠️ untested |
| WOFF2 | WOFF | GitHub Actions (`font_convert`) | ⚠️ untested |

### Maps / geo

| Source | Target | Runs on | Verification |
|---|---|---|---|
| KML | GEOJSON | Cloudflare Worker | ✅ unit |
| KML | GPX | Cloudflare Worker | ✅ unit |
| KML | CSV | Cloudflare Worker | ✅ unit |
| GPX | GEOJSON | Cloudflare Worker | ✅ unit |
| GPX | KML | Cloudflare Worker | ✅ unit |
| GPX | CSV | Cloudflare Worker | ✅ unit |
| GEOJSON | KML | Cloudflare Worker | ✅ unit |
| GEOJSON | GPX | Cloudflare Worker | ✅ unit |
| GEOJSON | CSV | Cloudflare Worker | ✅ unit |
| SHP | GEOJSON | GitHub Actions (`data_convert`) | ⚠️ untested |

### Contacts

| Source | Target | Runs on | Verification |
|---|---|---|---|
| VCF | CSV | Cloudflare Worker | ✅ unit |
| VCF | JSON | Cloudflare Worker | ✅ unit |
| VCF | XLSX | Cloudflare Worker | ✅ unit |

### Calendars

| Source | Target | Runs on | Verification |
|---|---|---|---|
| ICS | CSV | Cloudflare Worker | ✅ unit |
| ICS | JSON | Cloudflare Worker | ✅ unit |
| ICS | XLSX | Cloudflare Worker | ✅ unit |

### Logs / diffs

| Source | Target | Runs on | Verification |
|---|---|---|---|
| LOG | CSV | Cloudflare Worker | ✅ unit |
| LOG | JSON | Cloudflare Worker | ✅ unit |
| LOG | TXT | Cloudflare Worker | ✅ unit |
| LOG | MD | Cloudflare Worker | ✅ unit |
| DIFF | JSON | Cloudflare Worker | ✅ unit |
| DIFF | MD | Cloudflare Worker | ✅ unit |
| DIFF | HTML | Cloudflare Worker | ✅ unit |
| DIFF | TXT | Cloudflare Worker | ✅ unit |
| DIFF | PATCH | Cloudflare Worker | ✅ unit |
| PATCH | JSON | Cloudflare Worker | ✅ unit |
| PATCH | MD | Cloudflare Worker | ✅ unit |
| PATCH | HTML | Cloudflare Worker | ✅ unit |
| PATCH | TXT | Cloudflare Worker | ✅ unit |
| PATCH | DIFF | Cloudflare Worker | ✅ unit |

## 9. ZIP support

| Capability | Where | How | Status |
|---|---|---|---|
| Create a ZIP from attached/generated files (`zip_create`) | Cloudflare Worker | fflate; duplicate names become `name-2.ext` | ✅ unit |
| Bulk file generation → ZIP (multi-step plan: create files, then `zip_create`) | Worker (agent planner, ≤6 steps) | `src/lib/jobs/agent.server.ts` | 🟡 planner step cap tested; full bulk flow ⚠️ untested |
| List contents (`zip_list`) | Worker | entry names/sizes after safety check | ⚠️ untested as a tool |
| Extract (`zip_extract`) | Worker | safe paths only | ⚠️ untested as a tool |
| Archive analysis card when a single ZIP is attached in chat | Browser (JSZip) | tree, sizes, text previews (≤8000 chars/file, text extensions only) | ⚠️ no automated test |
| Repack ZIP ↔ TAR ↔ TGZ, GZ decompress, CBZ | Worker | `convert.ts` archive readers/writers | ✅ unit (incl. unsafe archive refusal) |
| 7Z / RAR / CBR → ZIP/TAR/7Z/TGZ/CBZ | GitHub Actions (`archive_convert`) | 7-Zip/libarchive; traversal rejected | ✅ runtime-CI for 7Z→ZIP and traversal; others ⚠️ |
| Project → ZIP download | Browser | `downloadProjectAsZip`, excludes secrets/ignored paths (`isExcludedFromExport`) | ✅ (security/tests) for exclusions |
| Builder project archives | Worker | `src/lib/builder/archive.ts` | ✅ `builder.test.ts` |

Safety limits (`ARCHIVE_LIMITS`): 25 MB upload, 5000 entries, 200 MB total uncompressed, 20 MB per entry, ratio ≤100 above 1 MB (zip-bomb guard), depth ≤30, path traversal/absolute paths rejected, secrets detected (`findSecretKinds`). **RAR creation is not supported** (proprietary encoder).

## 10. Other file tools

PDF: `pdf_merge`, `pdf_pages` (extract/split_each/delete/rotate ranges), `pdf_watermark`, `pdf_metadata` — Worker (pdf-lib); merge/extract/split ✅ unit, damaged-PDF refusal ✅ unit. Text: `change_case`, `find_replace`, `rewrite`, `format_code`. Data: `convert_data` (JSON/YAML/CSV/…), `query_data` group/aggregate/sort ✅ unit. Utility: `hash` ✅, `encode` ✅, `generate_secret` ✅, `privacy_scan` ✅, `validate` ✅, `calculate` ✅, `convert_units` ✅, `qr_code` ✅, `barcode` ✅ (`barcode.test.ts`), `web_fetch` (private URLs refused ✅), `web_search`, `search_files`. Large-file SHA-256/512 (≥10 MB, ≤25 MB) runs on GitHub Actions (`checksum`) ✅ runtime-CI.

## 11. Unsupported and partial capabilities

| Item | Status | Reason (from code) |
|---|---|---|
| Conversion *to* HEIC | ❌ | Not a runtime target (encoder licensing); refusal ✅ live-tested |
| TTF ↔ OTF | ❌ | Outline conversion not implemented; refusal ✅ runtime-CI |
| RAR / CBR creation | ❌ | Read-only; no RAR writer |
| DRM-protected e-books | ❌ | Calibre cannot and will not remove DRM |
| draw.io → PNG/SVG rendering | ❌ | Only extraction to DOT/Mermaid/text; render those instead |
| Image/audio/video generation | ❌ | Conversions operate on uploaded files only |
| Hindi / non-Latin text in app-generated PDFs | 🟡 | Built-in PDF font draws `?`; the count is reported ✅ unit |
| PDF → other formats | 🟡 | Text only; layout/images dropped |
| XLSX/ODS inline | 🟡 | Values only; formulas/charts/styles not kept |
| RTF/ODT inline | 🟡 | Text only; formatting preserved only via runtime |
| Prose → spreadsheet | ❌ | Refused when no table exists ✅ unit |
| Video content reading | ❌ | Only conversion / audio extraction |
| Video → WMA/AIFF audio | ❌ | Excluded in `routeConversion` |
| Executing code / SQL / notebooks / patches | ❌ | Treated as text, never run |
| Single ZIP attachment + convert prompt | 🟡 | Goes to ZIP analysis card, not the converter |

## 12. How to re-verify

```bash
bunx vitest run src/test/formats.test.ts src/test/runtime-ops.test.ts src/test/tools.test.ts
# runtime repo (needs ffmpeg, libreoffice, calibre, 7z, graphviz, plantuml, texlive):
pytest -q tests/
```

This document is regenerated from the registry; if a format's capability changes in `inventory.ts`, the matrix here must be regenerated rather than edited by hand.
