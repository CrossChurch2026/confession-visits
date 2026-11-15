# سجل زيارات الاعتراف

تطبيق ويب (HTML + JavaScript) يُستضاف على GitHub Pages، وتسجيل الدخول والبيانات على Firebase (Authentication + Firestore).

## الهيكل
كنيسة ← أب كاهن ← أشخاص ← زيارات (اليوم + الميعاد)

| الدور | الصلاحية |
|---|---|
| مدير البرنامج | كل شيء + الموافقة على المستخدمين وتحديد صلاحياتهم + الكنائس والكهنة |
| مسؤول كنيسة | كهنة وأشخاص وزيارات كنيسته فقط |
| أب كاهن | أشخاصه وزياراتهم فقط (إضافة/حذف) |
| مسجّل | يرى أشخاص أب كاهن محدد ويسجّل زيارات فقط |

## خطوات الإعداد

1. **Firebase Console** ← أنشئ مشروعًا.
2. **Authentication** ← Sign-in method ← فعّل **Google** و **Email/Password**.
3. **Firestore Database** ← Create database (Production mode).
4. **Firestore ← Rules** ← الصق محتوى `firestore.rules` ← Publish.
5. **Project settings ← Your apps ← Web** ← انسخ الإعدادات داخل `firebase-config.js`.
6. **Authentication ← Settings ← Authorized domains** ← أضف `USERNAME.github.io`.
7. ارفع الملفات (index.html, app.js, firebase-config.js) إلى مستودع GitHub، ثم
   **Settings ← Pages ← Deploy from branch (main / root)**.

## أول مدير للبرنامج (مرة واحدة)
1. افتح الموقع وسجّل الدخول بإيميلك (سيظهر "قيد المراجعة").
2. Firebase Console ← Firestore ← مجموعة `users` ← مستندك ← عدّل:
   `role = admin` و `status = approved`.
3. حدّث الصفحة. بعدها كل شيء من داخل البرنامج.

## ترتيب إدخال البيانات
كنيسة ← أب كاهن ← الموافقة على المستخدمين وربطهم ← الأشخاص ← الزيارات.

## ملاحظات
- لا يُخزَّن أي محتوى للاعتراف، فقط الاسم واليوم والميعاد. حافظ على ذلك.
- البيانات في Firestore وليست في Google Drive. زر **تصدير CSV** في تبويب الزيارات ينزّل نسخة تحفظها على Drive.
- تم تقييد الحماية في `firestore.rules` على الخادم، وليس في الواجهة فقط.
