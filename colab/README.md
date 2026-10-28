# تشغيل Zazo Brain من Google Colab

## فتح الدفتر

افتح الدفتر مباشرة من GitHub عبر الرابط:

https://colab.research.google.com/github/zazotona301-oss/zazo/blob/main/colab/zazo_brain_gemma_cloudflare_training.ipynb

أو افتح الملف `zazo_brain_gemma_cloudflare_training.ipynb` من مجلد `colab` وانسخه إلى Google Drive حتى يبقى لديك نسخة شخصية دائمة.

## المسار الموصى به: Hugging Face ثم GitHub Action ثم Cloudflare

لرفع محول LoRA إلى مستودع Hugging Face ثم تشغيل سير المزامنة إلى Cloudflare، افتح الدفتر التالي:

https://colab.research.google.com/github/zazotona301-oss/zazo/blob/main/colab/zazo_train_upload_huggingface.ipynb

يرفع الدفتر `adapter_config (1).json` و`adapter_model (1).safetensors` إلى `zazo300/zazo-gemma-lora`، ثم يستطيع تشغيل `sync-huggingface-cloudflare.yml` تلقائياً. يلزم `HF_TOKEN` بصلاحية كتابة على مستودع Hugging Face، أما `GH_TOKEN` فهو اختياري لتشغيل GitHub Action من داخل الدفتر؛ بدونه يمكن تشغيل الـworkflow يدوياً من GitHub.

يدعم الدفتر أيضاً رفع ملف `OnlineRetail.xlsx` مباشرة من الهاتف. يحول صفوف المعاملات إلى أمثلة عربية بصيغة `user/assistant`، يستبعد الفواتير الملغاة افتراضياً، ويبدأ بحد 10,000 مثال قابل للتعديل في `MAX_TRAINING_ROWS` حتى يناسب موارد GPU المتاحة.

### إصدارات Hugging Face

يمكن حفظ كل تدريب بإحدى الطريقتين؛ الأكشن يدعم مجلدات الإصدارات أو الأسماء المسطحة من الهاتف:

```text
v1-adapter_config.json
v1-adapter_model.safetensors
v2-adapter_config.json
v2-adapter_model.safetensors
```

أو:

```text
v1/adapter_config.json
v1/adapter_model.safetensors
v2/adapter_config.json
v2/adapter_model.safetensors
```

يبحث GitHub Action في مستودع `zazo301/brain` تلقائياً عن أعلى إصدار رقمي (`v1` ثم `v2` ثم `v3`) ويستخدمه مع Cloudflare. إذا كان `v1` داخل مجلد، يستخدمه؛ وإذا كان الاسم مسطحاً، يستخدم الاسم المسطح. وتبقى الإصدارات السابقة محفوظة ولا تُستبدل.

## الأسرار الدائمة

احفظ القيم من لوحة **Colab → Secrets**، وليس في خلايا الدفتر أو داخل Google Drive. فعّل **Notebook access** لكل سر. أسرار Colab محفوظة لحساب Google وتعود عند فتح أي Runtime جديد، لكن الجلسة نفسها مؤقتة وقد تحتاج إلى إعادة `drive.mount`.

### `HF_TOKEN` — اختياري في بعض الحسابات، مطلوب عند Gemma gated

أنشئه من Hugging Face من صفحة Settings → Access Tokens بصلاحية قراءة فقط (`read`). استخدمه الدفتر لتسجيل الدخول وتنزيل `google/gemma-2b-it` وتحميل نسخة Gemma المطلوبة للتحويل إلى Android. يجب أولًا قبول شروط Gemma في صفحة النموذج على Hugging Face. لا تمنحه صلاحية كتابة.

### `CF_AI_TOKEN` — مطلوب لرفع LoRA إلى Cloudflare

أنشئ Cloudflare API Token مخصصًا لحساب Zazo، بصلاحية Workers AI Write فقط إن كانت لوحة Cloudflare توفرها بهذا الاسم. يستخدمه الدفتر في إنشاء fine-tune ورفع `adapter_model.safetensors` إلى Workers AI. لا تضع Global API Key.

### `CF_KV_TOKEN` — مطلوب لمؤشرات Cloudflare وقراءة أرشيف البيانات

أنشئ Cloudflare API Token مخصصًا بصلاحيات KV اللازمة للحساب: قراءة وكتابة namespace `ACTIVE_CONTEXT`، وقراءة namespace `ARCHIVE_STORE`. يستخدمه الدفتر في قراءة dataset المصدر وتحديث مؤشر `active-lora`. لا تضع Global API Key.

## Google Drive

لا يوجد Google Drive API token داخل الدفتر. عند تشغيل `drive.mount('/content/drive')` سيعرض Colab نافذة تفويض Google لحسابك. ضع ملف التدريب في:

```text
My Drive/zazo_brain_lora/input/training.jsonl
```

ويحفظ الدفتر إصدارات التدريب في:

```text
My Drive/zazo_brain_lora/versions/
```

## إخراج Android

بعد نجاح التدريب، شغّل الخلية الأخيرة **تجهيز نسخة Android محلية**. تحتاج هذه الخلية إلى GPU ومساحة Drive كافية. ستنتج:

```text
zazo_android_model.zip
```

وتحتوي الحزمة على:

```text
base.bin
lora.bin
android_model_manifest.json
```

انقل ZIP إلى الهاتف واختره من زر **تثبيت نموذج Android المحلي** داخل التطبيق.

## لا تحفظ الأسرار هنا

لا تضع أي قيمة سرية في:

- خلية داخل الدفتر.
- ملف JSONL أو JSON.
- Google Drive.
- GitHub أو README.
- متغيرات Vite المنشورة.

إذا تسرب أي Token، ألغِه من مزود الخدمة وأنشئ Token جديدًا.
