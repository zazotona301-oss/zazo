import json
from pathlib import Path

notebook_path = Path('/home/ubuntu/work/zazo/colab/zazo_brain_gemma_cloudflare_training.ipynb')
data = json.loads(notebook_path.read_text(encoding='utf-8'))

new_source = '''from pathlib import Path
import csv

INPUT_DIR = DRIVE_ROOT / "input"
INPUT_DIR.mkdir(parents=True, exist_ok=True)
TRAINING_INPUT_NAME = os.getenv("ZAZO_TRAINING_INPUT", "").strip()
SUPPORTED_INPUT_SUFFIXES = {".jsonl", ".ndjson", ".json", ".csv", ".tsv"}

def find_training_input():
    if TRAINING_INPUT_NAME:
        selected = INPUT_DIR / TRAINING_INPUT_NAME
        if not selected.exists():
            raise RuntimeError(f"ملف التدريب المحدد غير موجود: {selected}")
        return selected
    preferred = [INPUT_DIR / name for name in ("training.jsonl", "training.ndjson", "training.json", "training.csv", "training.tsv")]
    for candidate in preferred:
        if candidate.exists():
            return candidate
    candidates = [path for path in INPUT_DIR.iterdir() if path.is_file() and path.suffix.lower() in SUPPORTED_INPUT_SUFFIXES]
    if not candidates:
        raise RuntimeError(f"ضع ملف التدريب في Google Drive داخل {INPUT_DIR}. الصيغ المدعومة: JSONL, NDJSON, JSON, CSV, TSV.")
    return max(candidates, key=lambda path: path.stat().st_mtime)

def load_drive_records(path):
    text = path.read_text(encoding="utf-8-sig")
    suffix = path.suffix.lower()
    if suffix in {".jsonl", ".ndjson"}:
        records = [json.loads(line) for line in text.splitlines() if line.strip()]
    elif suffix == ".json":
        payload = json.loads(text)
        records = payload if isinstance(payload, list) else payload.get("records", payload.get("data", [])) if isinstance(payload, dict) else []
    else:
        delimiter = "\\t" if suffix == ".tsv" else ","
        records = list(csv.DictReader(text.splitlines(), delimiter=delimiter))
    if not isinstance(records, list) or not records:
        raise RuntimeError(f"ملف التدريب فارغ أو لا يحتوي قائمة سجلات: {path.name}")
    if not all(isinstance(item, dict) for item in records):
        raise RuntimeError("يجب أن يكون كل سجل في ملف التدريب JSON object أو صفًا في CSV/TSV.")
    return records

training_input_path = find_training_input()
raw_records = load_drive_records(training_input_path)
dataset_sha256 = hashlib.sha256(training_input_path.read_bytes()).hexdigest()
manifest_key = f"drive://{training_input_path.relative_to(DRIVE_ROOT).as_posix()}"
created_at = datetime.fromtimestamp(training_input_path.stat().st_mtime, timezone.utc).isoformat()
expected_ready_rows = len(raw_records)

print("مصدر التدريب:", training_input_path)
print("عدد السجلات:", len(raw_records))
print("بصمة dataset SHA-256:", dataset_sha256)

latest_training_path = DRIVE_ROOT / "latest_training.json"
if latest_training_path.exists():
    previous_training = json.loads(latest_training_path.read_text(encoding="utf-8"))
    previous_hash = previous_training.get("dataset_sha256")
    if previous_hash == dataset_sha256 and not FORCE_RETRAIN_SAME_DATA:
        raise RuntimeError("هذه هي نفس بصمة بيانات آخر تدريب ناجح؛ غيّر الملف أو اضبط FORCE_RETRAIN_SAME_DATA=True لإعادة التدريب عمدًا.")
    if previous_hash:
        print("البصمة السابقة:", previous_hash, "— هل تغير المحتوى؟", previous_hash != dataset_sha256)
print("اكتمل فحص سلامة مصدر التدريب من Google Drive.")
'''

found_code = found_markdown = False
for cell in data['cells']:
    if str(cell.get('id', '')).startswith('33dfc66'):
        cell['source'] = new_source.splitlines(True)
        found_code = True
    elif cell.get('id') == 'b20d502a':
        cell['source'] = [
            '## 5. قراءة ملف التدريب من Google Drive\n',
            '\n',
            'ضع ملف JSONL أو NDJSON أو JSON أو CSV أو TSV داخل `MyDrive/zazo_brain_lora/input/`. يختار الدفتر `training.jsonl` أولًا، أو أحدث ملف مدعوم إذا لم يوجد اسم افتراضي. لا يعتمد إدخال التدريب على Cloudflare KV أو Neon.\n',
        ]
        found_markdown = True
if not found_code or not found_markdown:
    raise RuntimeError(f'cells not found: code={found_code}, markdown={found_markdown}')
notebook_path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
