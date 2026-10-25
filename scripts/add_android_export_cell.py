import json
from pathlib import Path

p = Path('/home/ubuntu/work/zazo/colab/zazo_brain_gemma_cloudflare_training.ipynb')
data = json.loads(p.read_text(encoding='utf-8'))

for cell in data['cells']:
    text = ''.join(cell.get('source', []))
    if 'LORA_TARGET_MODULES =' in text:
        cell['source'] = [line.replace('LORA_TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]', 'LORA_TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj"]') for line in cell['source']]

cell_id = 'android-export-v1'
if any(c.get('id') == cell_id for c in data['cells']):
    raise SystemExit('android export cell already exists')

new_cells = [
    {
        'cell_type': 'markdown',
        'id': 'android-export-md-v1',
        'metadata': {},
        'source': [
            '## 21. تجهيز نسخة Android محلية\n',
            '\n',
            'يحوّل هذا القسم Gemma 2B مع LoRA إلى ملفي FlatBuffer يدعمهما MediaPipe LLM Inference على Android: نموذج أساسي وملف LoRA. هذا هو المسار المدعوم لـ Gemma 2B المخصّص، بينما LiteRT-LM يستخدم نماذج `.litertlm` الجاهزة. يتطلب التحويل GPU ومساحة Drive كافية، ويُنتج حزمة `zazo_android_model.zip`.\n',
        ],
    },
    {
        'cell_type': 'code',
        'execution_count': None,
        'id': cell_id,
        'metadata': {},
        'outputs': [],
        'source': '''# Google MediaPipe converter: Gemma 2B + LoRA -> base.bin + lora.bin
# التشغيل اختياري لكنه مفعّل افتراضيًا بعد نجاح التدريب.
import os, shutil, subprocess, sys, zipfile
from huggingface_hub import snapshot_download

BUILD_ANDROID_MODEL = True
if BUILD_ANDROID_MODEL:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "mediapipe"])
    import mediapipe as mp
    from mediapipe.tasks.python.genai import converter

    ANDROID_DIR = DRIVE_VERSION_DIR / "android"
    ANDROID_DIR.mkdir(parents=True, exist_ok=True)
    BASE_MODEL_DIR = DRIVE_ROOT / "_cache" / MODEL_NAME.replace("/", "_")
    BASE_MODEL_DIR.parent.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=MODEL_NAME,
        local_dir=str(BASE_MODEL_DIR),
        token=HF_TOKEN or None,
        allow_patterns=["*.json", "*.safetensors", "*.model", "*.txt"],
    )

    base_output = ANDROID_DIR / "zazo_base_gpu.bin"
    lora_output = ANDROID_DIR / "zazo_lora_gpu.bin"
    intermediate = ANDROID_DIR / "intermediate"
    conversion_config = converter.ConversionConfig(
        input_ckpt=str(BASE_MODEL_DIR),
        ckpt_format="safetensors",
        model_type="GEMMA_2B",
        backend="gpu",
        output_dir=str(intermediate),
        combine_file_only=False,
        vocab_model_file=str(BASE_MODEL_DIR),
        output_tflite_file=str(base_output),
        lora_ckpt=str(adapter_weights_path),
        lora_rank=LORA_R,
        lora_output_tflite_file=str(lora_output),
    )
    converter.convert_checkpoint(conversion_config)
    if not base_output.exists() or not lora_output.exists():
        raise RuntimeError("لم ينتج المحول ملفات Android الأساسية وLoRA")

    bundle_manifest = {
        "format": "mediapipe-llm-inference-gemma-2b-lora",
        "model_name": MODEL_NAME,
        "backend": "gpu",
        "base_file": base_output.name,
        "lora_file": lora_output.name,
        "lora_rank": LORA_R,
        "target_modules": LORA_TARGET_MODULES,
        "dataset_sha256": dataset_sha256,
        "run_id": RUN_ID,
        "base_sha256": sha256_file(base_output),
        "lora_sha256": sha256_file(lora_output),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    manifest_path = ANDROID_DIR / "android_model_manifest.json"
    manifest_path.write_text(json.dumps(bundle_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    zip_path = DRIVE_VERSION_DIR / "zazo_android_model.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        archive.write(base_output, "base.bin")
        archive.write(lora_output, "lora.bin")
        archive.write(manifest_path, "android_model_manifest.json")
    print("تم تجهيز حزمة Android:", zip_path)
    print("ضع zazo_android_model.zip في التطبيق عبر زر تثبيت النموذج المحلي.")
else:
    print("تم تجاوز تجهيز Android. اضبط BUILD_ANDROID_MODEL=True لإنتاج الحزمة.")
'''.splitlines(True),
    },
]

insert_at = next((i + 1 for i, c in enumerate(data['cells']) if c.get('id') == '52f4d16b'), None)
if insert_at is None:
    raise SystemExit('save cell not found')
data['cells'][insert_at:insert_at] = new_cells
p.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
