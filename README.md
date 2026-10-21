# Zazo Brain

واجهة React/Vite عربية مع تطبيق Android أصلي صغير بلغة Kotlin يعرض الواجهة نفسها داخل WebView آمن باستخدام `WebViewAssetLoader`. يجري تضمين ناتج React داخل التطبيق وقت البناء، لذلك لا يعتمد تشغيل الواجهة على استضافة ويب خارجية. يحتاج اتصال Supabase إلى إعدادات المشروع الحالية.

## بناء التطبيق محلياً

المتطلبات: Node.js 22، JDK 17، Android SDK (منصة Android 35 وأدوات البناء)، واتصال بالإنترنت لتنزيل اعتماديات Gradle وnpm.

```bash
./android/gradlew -p android assembleDebug
```

ينتج APK التجربة في `android/app/build/outputs/apk/debug/app-debug.apk`. ولإنشاء إصدار محلي، وفّر متغيرات بيئة التوقيع الموضحة أدناه ثم شغّل `assembleRelease bundleRelease`.

## نشر إصدار Android

سير العمل `.github/workflows/android-release.yml` ينطلق عند نشر إصدار من [صفحة إنشاء GitHub Release](https://github.com/zazotona301-oss/zazo/releases/new)، ويبني APK وAAB من واجهة React، يتحقق من التوقيع، ثم يرفعهما إلى الإصدار نفسه وينشر فهرس التنزيلات على GitHub Pages. لتنفيذ أول إصدار:

1. في إعدادات المستودع افتح **Settings → Secrets and variables → Actions** وأضف الأسرار التالية:
   - `ANDROID_KEYSTORE_BASE64`: محتوى ملف Java keystore بترميز Base64 أحادي السطر.
   - `ANDROID_KEYSTORE_PASSWORD`: كلمة مرور ملف keystore.
   - `ANDROID_KEY_ALIAS`: اسم المفتاح داخل الملف.
   - `ANDROID_KEY_PASSWORD`: كلمة مرور المفتاح.
   - `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY`: قيم عميل Supabase العامة، عند الرغبة في تشغيل وظائف البيانات.
2. أنشئ keystore بنفسك واحفظ نسخة احتياطية آمنة خارج GitHub. مثال إنشاء مفتاح JKS: `keytool -genkeypair -v -storetype JKS -keystore zazo-release.jks -alias zazo-release -keyalg RSA -keysize 3072 -validity 10000`. لا ترفع keystore أو كلمات مروره إلى Git أو Issues. يمكن تحويل الملف إلى Base64 محلياً بـ `base64 -w 0 zazo-release.jks` (أو `base64 zazo-release.jks` على macOS) ثم وضع الناتج في السر المذكور. فقد المفتاح يمنع توقيع تحديثات قابلة للتثبيت فوق النسخة المنشورة.
3. افتح [إعدادات GitHub Pages](https://github.com/zazotona301-oss/zazo/settings/pages)، ثم في **Build and deployment → Source** اختر **GitHub Actions** واحفظ. هذا تفعيل لمرة واحدة؛ لا يستطيع رمز GitHub Actions الحالي إنشاء موقع Pages بنفسه. إذا لم يكن الموقع مفعّلاً، سيضيف سير العمل تحذيراً ويتخطى نشر الفهرس، مع إكمال بناء APK/AAB ورفعها. بعد التفعيل أعد تشغيل سير العمل على الوسم الموجود لنشر الفهرس.
4. افتح [إنشاء إصدار جديد](https://github.com/zazotona301-oss/zazo/releases/new)، اختر أو أنشئ وسماً مثل `v1.0.0` واجعل الهدف `main`، ثم اضغط **Publish release**. بعد النشر، يبدأ GitHub Actions تلقائياً ويضيف APK وAAB و`SHA256SUMS.txt` إلى صفحة الإصدار ذاتها. استخدم وسماً جديداً بصيغة `vX.Y.Z` لكل إصدار لاحق.

إذا فشل بناء إصدار منشور وأُصلح السبب، يمكن إعادة المحاولة من **Actions → Android release → Run workflow** مع إدخال الوسم الموجود، مثل `v1.0.0`، لإرفاق الملفات بالإصدار نفسه.

أسماء أسرار Supabase هنا قيم عميل فقط؛ المفتاح الذي يضمّن في تطبيق Android سيكون متاحاً لمستخدم التطبيق. لا تستخدم أبداً مفتاح Supabase من نوع `service_role` في تطبيق أو متغيرات Vite.

## التنزيل والتحديث الهوائي

- تصدر ملفات الإصدارات إلى **GitHub Releases** كـ `zazo-vX.Y.Z.apk` و`zazo-vX.Y.Z.aab` مع ملف SHA-256.
- صفحة التنزيلات على GitHub Pages تعرض روابط الأصول مباشرة لكل إصدار. رابط الصفحة يظهر في ملخص نشر GitHub Actions بعد تفعيل Pages.
- عند فتح التطبيق، يفحص Kotlin أحدث إصدار ثابت عبر GitHub Releases API ويقارن الوسم باسم نسخة التطبيق. إذا وُجد APK أحدث، يعرض حواراً، وينزّله من GitHub ويتحقق من SHA-256 الذي يعيده GitHub، ثم يفتح مثبت Android. يظل تأكيد التثبيت وإذن “تثبيت تطبيقات غير معروفة” بيد المستخدم؛ لا يدعم Android تثبيت APK بصمت لتطبيق عادي.
- المستودع عام حالياً، لذلك يستطيع التطبيق قراءة الإصدار وتنزيل APK بلا رمز أو تسجيل دخول. الإصدار `v1.0.0` لا يحدّث نسخة `1.0.0` نفسها؛ سيظهر التحديث عند نشر وسم أعلى مثل `v1.0.1`.
- صفحة GitHub Pages وفهرسها لا ينشران قبل تفعيل **Source: GitHub Actions** من الإعدادات. بعد ذلك يعيد النشر بناء الصفحة ويعرض روابط Releases. بما أن المستودع عام، فالكود والإصدارات وروابط التنزيل عامة أيضاً.

## الأسرار المطلوبة على GitHub

لا يضع المستودع مفاتيح التوقيع أو بيانات Supabase داخل المصدر. إذا لم تضف الأسرار الأربعة `ANDROID_*` فسيرفض سير عمل الإصدارات إنتاج إصدار غير موقّع. إعداد Supabase اختياري للبناء لكنه مطلوب كي تتصل المحادثات وقاعدة المعرفة والتحليلات بقاعدة بيانات المشروع.
