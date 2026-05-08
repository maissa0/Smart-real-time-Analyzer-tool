# CAN log pipeline (`python_parser`)

Parse CAN ASCII logs using XML catalogues, optionally publish decoded sessions to Kafka.

## Setup

From the `python_parser` directory:

**Windows (PowerShell)**

```powershell
cd python_parser
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**macOS / Linux**

```bash
cd python_parser
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Copy XML catalogs

Place `car_can.xml` and `key_can.xml` under `catalogues/` (they ship with this repo).

## Run

Dry run (parse and decode only; no Kafka):

```bash
python pipeline.py --log ../log_file.txt --dry-run
```

Full run (requires Kafka on `localhost:9092` by default):

```bash
python pipeline.py --log ../log_file.txt
```

Optional flags: `--catalogues <dir>`, `--session-id <id>`, `--kafka <host:port>`.

## Test

```bash
pytest tests/ -v
```

(Run from `python_parser` so imports resolve.)
