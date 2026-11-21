// Interface text only. Quranic text is never placed here — it comes verbatim from data/al-baqarah.json.
const en = {
  appName: 'Baqarah Together',
  nav_home: 'Home', nav_read: 'Read', nav_family: 'Family', nav_history: 'History', nav_settings: 'Settings',
  loading: 'Loading…', retry: 'Try again', save: 'Save', saved: 'Saved', cancel: 'Cancel', close: 'Close', copy: 'Copy', copied: 'Copied',
  share: 'Share', remove: 'Remove', rename: 'Rename', edit: 'Edit', back: 'Back', continue_: 'Continue',

  // auth
  signin_title: 'Welcome back', signin_sub: 'Sign in to your family’s reading space.',
  login_name: 'Login name', pin: 'PIN', pin_again: 'PIN again', signin: 'Sign in', signing_in: 'Signing in…',
  signin_help: 'Forgot your PIN? Ask your family administrator for a new sign-in link.',
  private_note: 'This is a private family space. Only invited family members can sign in.',
  setup_title: 'Set up your family', setup_sub: 'You will be the family administrator. You can invite up to five more family members next.',
  setup_code: 'Setup code', setup_code_help: 'Shown in the server log when the app first starts.',
  family_name: 'Family name', your_name: 'Your name', create_family: 'Create family',
  invite_title: 'Assalamu alaikum, {name}', invite_sub: 'You have been invited to join {family} to read Surah Al-Baqarah together.',
  reset_title: 'Choose a new PIN, {name}', reset_sub: 'Your family administrator sent you this link to reset your PIN.',
  choose_login: 'Choose a login name', login_hint: 'Lowercase letters or numbers, e.g. maryam',
  choose_pin: 'Choose a PIN', pin_hint: '4–6 digits. Avoid 1234 or 1111.', pin_hint_admin: '6 digits. Avoid 123456 or 111111.',
  join_family: 'Join the family', set_pin: 'Save new PIN', invite_invalid_title: 'This link can’t be used',
  invite_invalid_sub: 'It may have expired or already been used. Please ask your family administrator for a new link.',
  pins_differ: 'The two PINs are different.',

  // home
  greeting: 'Assalamu alaikum, {name}', today: 'Today', todays_reading: 'Today’s reading',
  done_today: 'You’ve completed today’s reading. May Allah accept it.', not_yet_today: 'Your reading is waiting for you whenever you’re ready.',
  continue_reading: 'Continue reading', start_reading: 'Start reading', read_again: 'Read more',
  continue_from: 'Continue from verse {v}', verses_range: 'Verses {from}–{to}', mark_complete: 'Mark today complete', completed_today: 'Completed today',
  undo: 'Undo', streak: 'Day streak', total_days: 'Days read', verses_read: 'Verses read', full_readings: 'Full readings',
  portion_progress: 'Today’s portion', surah_progress: 'Through the Surah',
  family_today: 'Family today', family_done: '{done} of {total} have read today',

  // encouragement (never comparative)
  enc_all: 'The family has completed today’s reading together. Alhamdulillah.',
  enc_some: 'May Allah make it easy for everyone to read today.',
  you: 'you',
  enc_none: 'A new day to read together. Bismillah.',
  enc_finished_surah: 'You have completed Surah Al-Baqarah. Alhamdulillah! You will begin again from verse 1.',
  marked_done: 'Today is marked complete. Alhamdulillah.',

  // reader
  surah_title: 'Surah Al-Baqarah', surah_sub: 'The Cow · 286 verses · Madinan',
  font_smaller: 'Smaller text', font_larger: 'Larger text', theme_toggle: 'Light or dark', bookmarks: 'Bookmarks',
  bookmark: 'Bookmark', remove_bookmark: 'Remove bookmark', set_place: 'Save as my place', place_saved: 'Your place is saved',
  page_n: 'Page {p}', juz_n: 'Juz {j}', go_to_verse: 'Go to verse', go: 'Go', beginning: 'Beginning of the Surah',
  continued_from: 'Continued from verse {v}', jump_start: 'Start of today’s portion', no_bookmarks: 'No bookmarks yet. Tap a verse to bookmark it.',
  verse_n: 'Verse {n}', autosave_note: 'Your place is saved automatically.',
  source_line: 'Arabic text: Tanzil Project (tanzil.net), Uthmani text, used verbatim. Page numbers: Quran.com.',

  // family
  family_title: 'Our family', read_today: 'Read today', not_yet: 'Not yet', invited: 'Invited',
  this_week: 'This week', last_30: 'Last 30 days', together_totals: 'Together so far',
  days_all_together: 'Days everyone read', reading_days: 'Reading days', family_verses: 'Verses read together',
  surah_completions: 'Full readings of the Surah', day_count: '{n} of {t} read',

  // history
  history_title: 'My reading', recent: 'Recent days', no_history: 'No days marked yet. Your first day will appear here.',
  gentle_missed: '{n} days in the past month were not marked. Every day is a fresh start.',
  gentle_missed_none: 'You have read every day this past month. Alhamdulillah.',

  // settings
  profile: 'Profile', display_name: 'Display name', avatar: 'Avatar', color: 'Colour', none: 'Initials',
  reading_plan: 'Reading pace', plan_free: 'At my own pace', plan_free_d: 'Continue from where you stopped; mark the day when you’ve read.',
  plan_whole: 'Whole Surah each day', plan_whole_d: 'Read all 286 verses in one day.',
  plan_verses: 'Verses per day', plan_verses_d: 'A set number of verses each day.',
  plan_days: 'Finish over a number of days', plan_days_d: 'The Surah divided evenly.', per_day: 'verses per day', over_days: 'days',
  display: 'Display', language: 'Language', theme: 'Theme', theme_system: 'Match my phone', theme_light: 'Light', theme_dark: 'Dark',
  quran_font_size: 'Quran text size', timezone: 'Time zone', timezone_help: 'Your “today” starts at midnight in this time zone.',
  detected: 'Detected on this device: {tz}', use_detected: 'Use this',
  security: 'Security', change_pin: 'Change PIN', current_pin: 'Current PIN', new_pin: 'New PIN', pin_changed: 'PIN changed.',
  your_data: 'Your data', export: 'Download my data', delete_account: 'Delete my account',
  delete_confirm: 'This permanently deletes your profile, progress, bookmarks and notes. Enter your PIN to confirm.',
  sign_out: 'Sign out',
  admin: 'Family administration', admin_only_note: 'Only you, as administrator, can see this section.',
  family_settings: 'Family settings', family_timezone: 'Family time zone', family_tz_help: 'Used for the family’s weekly and monthly history.',
  members: 'Members', members_count: '{n} of {max} members', add_member: 'Add a family member', member_name: 'Their name',
  create_invite: 'Create invite link', invite_ready: 'Send this link to {name}. It works once and expires in 7 days.',
  new_link: 'New sign-in link', new_link_reset: 'New link (reset PIN)', remove_confirm: 'Remove {name} from the family? Their reading history will be deleted.',
  role_admin: 'Administrator', role_member: 'Member', status_invited: 'Invitation sent', last_seen: 'Last active {d}', family_full: 'The family has six members.',
  backup: 'Download family backup', backup_help: 'A copy of everyone’s reading history (no PINs). Keep it somewhere safe; download one every month or so.',
  about: 'About', disclaimer: 'This application is a reading and tracking tool. It is not a source of religious rulings — please consult qualified scholars for religious questions.',
  coming_soon: 'Coming next: reminders, audio recitation, translations and reflections.',

  // errors
  err_generic: 'Something went wrong. Please try again.', err_network: 'Can’t reach the server. Check your connection and try again.',
  err_bad_credentials: 'That login name or PIN is not right.', err_account_locked: 'Too many tries. Please wait 15 minutes, or ask your administrator for a new link.',
  err_too_many_attempts: 'Too many tries from this device. Please wait a few minutes.',
  err_pin_digits: 'The PIN should contain digits only.', err_pin_length: 'The PIN should be 4 to 6 digits.', err_pin_length_admin: 'The administrator PIN should be 6 digits.',
  err_pin_too_simple: 'Please choose a less predictable PIN.', err_login_name_format: 'Use 3–30 lowercase letters, numbers, dots or dashes.',
  err_login_name_taken: 'That login name is already used. Please choose another.', err_bad_setup_code: 'The setup code is not correct.',
  err_current_pin_wrong: 'Your current PIN is not right.', err_family_full: 'The family already has six members.',
  err_last_admin: 'You are the only administrator. Make someone else administrator first.', err_name_required: 'Please enter a name.',
  err_not_signed_in: 'Please sign in again.', err_invite_invalid: 'This link can’t be used anymore.',
};

const ar = {
  appName: 'البقرة معًا',
  nav_home: 'الرئيسية', nav_read: 'القراءة', nav_family: 'العائلة', nav_history: 'السجل', nav_settings: 'الإعدادات',
  loading: 'جارٍ التحميل…', retry: 'حاول مرة أخرى', save: 'حفظ', saved: 'تم الحفظ', cancel: 'إلغاء', close: 'إغلاق', copy: 'نسخ', copied: 'تم النسخ',
  share: 'مشاركة', remove: 'إزالة', rename: 'تغيير الاسم', edit: 'تعديل', back: 'رجوع', continue_: 'متابعة',

  signin_title: 'مرحبًا بعودتك', signin_sub: 'سجّل الدخول إلى مساحة القراءة العائلية.',
  login_name: 'اسم الدخول', pin: 'الرمز السري', pin_again: 'أعد إدخال الرمز', signin: 'دخول', signing_in: 'جارٍ الدخول…',
  signin_help: 'نسيت الرمز؟ اطلب من مسؤول العائلة رابط دخول جديدًا.',
  private_note: 'هذه مساحة عائلية خاصة. لا يدخلها إلا أفراد العائلة المدعوون.',
  setup_title: 'إعداد العائلة', setup_sub: 'ستكون مسؤول العائلة، ويمكنك دعوة خمسة أفراد آخرين.',
  setup_code: 'رمز الإعداد', setup_code_help: 'يظهر في سجل الخادم عند التشغيل الأول.',
  family_name: 'اسم العائلة', your_name: 'اسمك', create_family: 'إنشاء العائلة',
  invite_title: 'السلام عليكم يا {name}', invite_sub: 'دُعيت للانضمام إلى {family} لقراءة سورة البقرة معًا.',
  reset_title: 'اختر رمزًا جديدًا يا {name}', reset_sub: 'أرسل إليك مسؤول العائلة هذا الرابط لإعادة تعيين الرمز.',
  choose_login: 'اختر اسم الدخول', login_hint: 'حروف إنجليزية صغيرة أو أرقام، مثل maryam',
  choose_pin: 'اختر رمزًا سريًا', pin_hint: 'من ٤ إلى ٦ أرقام، وتجنّب ١٢٣٤ أو ١١١١.', pin_hint_admin: '٦ أرقام، وتجنّب ١٢٣٤٥٦ أو ١١١١١١.',
  join_family: 'انضم إلى العائلة', set_pin: 'حفظ الرمز الجديد', invite_invalid_title: 'لا يمكن استخدام هذا الرابط',
  invite_invalid_sub: 'ربما انتهت صلاحيته أو استُخدم من قبل. اطلب رابطًا جديدًا من مسؤول العائلة.',
  pins_differ: 'الرمزان غير متطابقين.',

  greeting: 'السلام عليكم يا {name}', today: 'اليوم', todays_reading: 'قراءة اليوم',
  done_today: 'أتممت قراءة اليوم، تقبّل الله منك.', not_yet_today: 'قراءتك بانتظارك متى ما كنت مستعدًا.',
  continue_reading: 'تابع القراءة', start_reading: 'ابدأ القراءة', read_again: 'اقرأ المزيد',
  continue_from: 'تابع من الآية {v}', verses_range: 'الآيات {from}–{to}', mark_complete: 'أتممت قراءة اليوم', completed_today: 'تمّت قراءة اليوم',
  undo: 'تراجع', streak: 'أيام متتالية', total_days: 'أيام القراءة', verses_read: 'آيات مقروءة', full_readings: 'ختمات السورة',
  portion_progress: 'ورد اليوم', surah_progress: 'التقدّم في السورة',
  family_today: 'العائلة اليوم', family_done: '{done} من {total} قرؤوا اليوم',

  enc_all: 'أتمّت العائلة قراءة اليوم معًا. الحمد لله.',
  enc_some: 'يسّر الله للجميع قراءة اليوم.',
  you: 'أنت',
  enc_none: 'يوم جديد نقرأ فيه معًا. بسم الله.',
  enc_finished_surah: 'أتممت سورة البقرة، الحمد لله! ستبدأ من جديد من الآية الأولى.',
  marked_done: 'سُجّلت قراءة اليوم. الحمد لله.',

  surah_title: 'سورة البقرة', surah_sub: '٢٨٦ آية · مدنية',
  font_smaller: 'تصغير الخط', font_larger: 'تكبير الخط', theme_toggle: 'فاتح أو داكن', bookmarks: 'العلامات',
  bookmark: 'وضع علامة', remove_bookmark: 'إزالة العلامة', set_place: 'احفظ موضعي هنا', place_saved: 'حُفظ موضعك',
  page_n: 'الصفحة {p}', juz_n: 'الجزء {j}', go_to_verse: 'اذهب إلى آية', go: 'اذهب', beginning: 'بداية السورة',
  continued_from: 'تابعت من الآية {v}', jump_start: 'بداية ورد اليوم', no_bookmarks: 'لا توجد علامات بعد. اضغط على آية لوضع علامة.',
  verse_n: 'الآية {n}', autosave_note: 'يُحفظ موضعك تلقائيًا.',
  source_line: 'النص العربي: مشروع تنزيل (tanzil.net)، الرسم العثماني، دون أي تعديل. أرقام الصفحات: Quran.com.',

  family_title: 'عائلتنا', read_today: 'قرأ اليوم', not_yet: 'لم يقرأ بعد', invited: 'مدعو',
  this_week: 'هذا الأسبوع', last_30: 'آخر ٣٠ يومًا', together_totals: 'معًا حتى الآن',
  days_all_together: 'أيام قرأ فيها الجميع', reading_days: 'أيام القراءة', family_verses: 'آيات قرأناها معًا',
  surah_completions: 'ختمات السورة', day_count: '{n} من {t} قرؤوا',

  history_title: 'قراءتي', recent: 'الأيام الأخيرة', no_history: 'لم تُسجَّل أيام بعد. سيظهر يومك الأول هنا.',
  gentle_missed: '{n} أيام في الشهر الماضي لم تُسجَّل. كل يوم بداية جديدة.',
  gentle_missed_none: 'قرأت كل يوم في الشهر الماضي. الحمد لله.',

  profile: 'الملف الشخصي', display_name: 'الاسم الظاهر', avatar: 'الصورة الرمزية', color: 'اللون', none: 'الحروف الأولى',
  reading_plan: 'وتيرة القراءة', plan_free: 'على راحتي', plan_free_d: 'تابع من حيث توقفت، وسجّل اليوم عندما تقرأ.',
  plan_whole: 'السورة كاملة كل يوم', plan_whole_d: 'قراءة الآيات الـ٢٨٦ في يوم واحد.',
  plan_verses: 'عدد آيات يومي', plan_verses_d: 'عدد ثابت من الآيات كل يوم.',
  plan_days: 'الختم خلال عدد من الأيام', plan_days_d: 'تقسيم السورة بالتساوي.', per_day: 'آية في اليوم', over_days: 'يومًا',
  display: 'العرض', language: 'اللغة', theme: 'المظهر', theme_system: 'حسب الهاتف', theme_light: 'فاتح', theme_dark: 'داكن',
  quran_font_size: 'حجم خط المصحف', timezone: 'المنطقة الزمنية', timezone_help: 'يبدأ «اليوم» عندك من منتصف الليل في هذه المنطقة.',
  detected: 'المنطقة في هذا الجهاز: {tz}', use_detected: 'استخدمها',
  security: 'الأمان', change_pin: 'تغيير الرمز', current_pin: 'الرمز الحالي', new_pin: 'الرمز الجديد', pin_changed: 'تم تغيير الرمز.',
  your_data: 'بياناتك', export: 'تنزيل بياناتي', delete_account: 'حذف حسابي',
  delete_confirm: 'سيُحذف ملفك وتقدّمك وعلاماتك وملاحظاتك نهائيًا. أدخل رمزك للتأكيد.',
  sign_out: 'تسجيل الخروج',
  admin: 'إدارة العائلة', admin_only_note: 'هذا القسم يظهر لك فقط بصفتك المسؤول.',
  family_settings: 'إعدادات العائلة', family_timezone: 'المنطقة الزمنية للعائلة', family_tz_help: 'تُستخدم لسجل العائلة الأسبوعي والشهري.',
  members: 'الأفراد', members_count: '{n} من {max} أفراد', add_member: 'إضافة فرد من العائلة', member_name: 'اسمه',
  create_invite: 'إنشاء رابط دعوة', invite_ready: 'أرسل هذا الرابط إلى {name}. يعمل مرة واحدة وتنتهي صلاحيته بعد ٧ أيام.',
  new_link: 'رابط دخول جديد', new_link_reset: 'رابط جديد (إعادة تعيين الرمز)', remove_confirm: 'إزالة {name} من العائلة؟ سيُحذف سجل قراءته.',
  role_admin: 'مسؤول', role_member: 'فرد', status_invited: 'أُرسلت الدعوة', last_seen: 'آخر نشاط {d}', family_full: 'اكتمل عدد العائلة (ستة أفراد).',
  backup: 'تنزيل نسخة احتياطية للعائلة', backup_help: 'نسخة من سجل قراءة الجميع (دون الرموز السرية). احفظها في مكان آمن، ويُفضّل تنزيلها كل شهر تقريبًا.',
  about: 'حول التطبيق', disclaimer: 'هذا التطبيق أداة للقراءة والمتابعة، وليس مصدرًا للفتوى أو الأحكام الشرعية. يُرجى الرجوع إلى أهل العلم في المسائل الدينية.',
  coming_soon: 'قريبًا: التذكيرات، والتلاوة الصوتية، والترجمات، والتأملات.',

  err_generic: 'حدث خطأ. حاول مرة أخرى.', err_network: 'تعذّر الاتصال بالخادم. تحقق من الاتصال وحاول مجددًا.',
  err_bad_credentials: 'اسم الدخول أو الرمز غير صحيح.', err_account_locked: 'محاولات كثيرة. انتظر ١٥ دقيقة أو اطلب رابطًا جديدًا من المسؤول.',
  err_too_many_attempts: 'محاولات كثيرة من هذا الجهاز. انتظر بضع دقائق.',
  err_pin_digits: 'يجب أن يتكون الرمز من أرقام فقط.', err_pin_length: 'يجب أن يكون الرمز من ٤ إلى ٦ أرقام.', err_pin_length_admin: 'يجب أن يكون رمز المسؤول ٦ أرقام.',
  err_pin_too_simple: 'اختر رمزًا يصعب توقّعه.', err_login_name_format: 'استخدم من ٣ إلى ٣٠ حرفًا إنجليزيًا صغيرًا أو أرقامًا.',
  err_login_name_taken: 'اسم الدخول مستخدم. اختر اسمًا آخر.', err_bad_setup_code: 'رمز الإعداد غير صحيح.',
  err_current_pin_wrong: 'الرمز الحالي غير صحيح.', err_family_full: 'اكتمل عدد أفراد العائلة.',
  err_last_admin: 'أنت المسؤول الوحيد. اجعل فردًا آخر مسؤولًا أولًا.', err_name_required: 'يرجى إدخال اسم.',
  err_not_signed_in: 'يرجى تسجيل الدخول مجددًا.', err_invite_invalid: 'لم يعد بالإمكان استخدام هذا الرابط.',
};

const dicts = { en, ar };

export function makeT(locale) {
  const d = dicts[locale] || en;
  const nf = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en');
  const t = (key, vars) => {
    let s = d[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, typeof v === 'number' ? nf.format(v) : v);
    return s;
  };
  t.num = (n) => nf.format(n);
  t.locale = locale;
  t.dateFmt = (ymd, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => {
    const [y, m, dd] = ymd.split('-').map(Number);
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd)));
  };
  t.err = (code) => (d[`err_${code}`] || en[`err_${code}`] ? t(`err_${code}`) : t('err_generic'));
  return t;
}

/** Ayah number in Arabic-Indic digits, used inside the end-of-ayah ornament. */
export const arabicDigits = (n) => String(n).replace(/\d/g, (c) => '٠١٢٣٤٥٦٧٨٩'[c]);
