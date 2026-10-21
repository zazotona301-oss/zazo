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
3. من **Settings → Pages** اختر **GitHub Actions** كمصدر البناء والنشر. أول نشر يحتاج تفعيل GitHub Pages للمستودع.
4. افتح [إنشاء إصدار جديد](https://github.com/zazotona301-oss/zazo/releases/new)، اختر أو أنشئ وسماً مثل `v1.0.0` واجعل الهدف `main`، ثم اضغط **Publish release**. بعد النشر، يبدأ GitHub Actions تلقائياً ويضيف APK وAAB و`SHA256SUMS.txt` إلى صفحة الإصدار ذاتها. استخدم وسماً جديداً بصيغة `vX.Y.Z` لكل إصدار لاحق.

أسماء أسرار Supabase هنا قيم عميل فقط؛ المفتاح الذي يضمّن في تطبيق Android سيكون متاحاً لمستخدم التطبيق. لا تستخدم أبداً مفتاح Supabase من نوع `service_role` في تطبيق أو متغيرات Vite.

## التنزيل والتحديث الهوائي

- تصدر ملفات الإصدارات إلى **GitHub Releases** كـ `zazo-vX.Y.Z.apk` و`zazo-vX.Y.Z.aab` مع ملف SHA-256.
- صفحة التنزيلات على GitHub Pages تعرض روابط الأصول مباشرة لكل إصدار. رابط الصفحة يظهر في ملخص نشر GitHub Actions بعد تفعيل Pages.
- عند فتح التطبيق، يفحص Kotlin أحدث إصدار ثابت من GitHub Releases. إذا وُجد APK أحدث، يعرض حواراً، ينزّل الملف من GitHub ويتحقق من SHA-256 إن أرسله GitHub، ثم يفتح مثبت Android. يظل تأكيد التثبيت وإذن “تثبيت تطبيقات غير معروفة” بيد المستخدم؛ لا يدعم Android تثبيت APK بصمت لتطبيق عادي.
- هذا المستودع خاص حالياً. لذلك تحتاج ملفات Releases إلى تسجيل دخول GitHub وصلاحية على المستودع؛ وواجهة التحديث غير الموثّقة داخل التطبيق لا تستطيع قراءة إصدار خاص عبر GitHub API. لكي يعمل التحديث التلقائي للجميع من داخل التطبيق، يجب أن تكون الإصدارات متاحة دون تسجيل دخول (مثلاً جعل المستودع/مصدر الإصدارات عاماً، إذا كان ذلك مناسباً لك). لم يُغيّر إعداد خصوصية المستودع.
- GitHub Pages قد يكون عاماً حسب إعدادات الحساب والخطة. الفهرس المنشور يعرض أسماء الإصدارات وروابطها، بينما تنزيل ملفات Release الخاصة يظل خاضعاً لصلاحيات GitHub. راجع خصوصية النشر قبل أول إصدار.

## الأسرار المطلوبة على GitHub

لا يضع المستودع مفاتيح التوقيع أو بيانات Supabase داخل المصدر. إذا لم تضف الأسرار الأربعة `ANDROID_*` فسيرفض سير عمل الإصدارات إنتاج إصدار غير موقّع. إعداد Supabase اختياري للبناء لكنه مطلوب كي تتصل المحادثات وقاعدة المعرفة والتحليلات بقاعدة بيانات المشروع.
