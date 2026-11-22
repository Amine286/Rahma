/* إعدادات أسواق رحمة — هذا هو الملف الوحيد الذي تعدّله */
window.RM_CONFIG = {
  APP_NAME: 'أسواق رحمة',
  APP_SUBTITLE: 'نظام المنتجات والطلبات',
  VERSION: '1.0.0',

  // رابط تطبيق الويب من Google Apps Script (ينتهي بـ /exec)
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxoWFijDolxDjFdhiOwFCxnAA60cDOcEDaX97Z5z5NusL68L5qtrXG5L1oWU8bgMkyd/exec',

  // المزامنة التلقائية كل كم دقيقة (والمزامنة تتم أيضاً عند عودة الإنترنت)
  AUTO_SYNC_MINUTES: 5,

  // بادئة رقم الطلبية، مثال: BC-0001
  ORDER_PREFIX: 'BC',

  // الجهة المستلمة الافتراضية في الطلبية (تتبدل من صفحة الإعدادات)
  DEFAULT_RECEIVER: 'مخزن أسواق رحمة',

  // رقم واتساب الذي تُرسل إليه الطلبيات (اختياري). بالصيغة الدولية أو 05XXXXXXXX
  WHATSAPP_NUMBER: '',

  // مسارات الصور: استبدل الملفات بنفس الأسماء، والموقع لا يتعطل إذا غابت
  IMAGES: {
    logo: 'assets/images/logo.png',
    hero: 'assets/images/hero-banner.png',
    loginBackground: 'assets/images/login-background.png',
    icon192: 'assets/images/app-icon-192.png',
    icon512: 'assets/images/app-icon-512.png'
  }
};
