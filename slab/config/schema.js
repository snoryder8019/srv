// ─────────────────────────────────────────────────────────────────────────────
// Slab design schema — single source of truth for tenant design tokens.
//
// Extracted from routes/admin/design.js so any module (including sections.js,
// which design.js imports) can read the schema without an import cycle. This
// file must stay a LEAF: import nothing from routes/ or plugins/.
//
// Storage model: SPARSE. A tenant's `design` collection holds only intentional
// overrides; every absent key falls through to these defaults at read time
// (`{ ...DESIGN_DEFAULTS }` then overlay stored rows). Adding a key here makes
// it live on every tenant instantly — no per-tenant backfill.
// ─────────────────────────────────────────────────────────────────────────────

export const DESIGN_DEFAULTS = {
  color_primary:       '#1C2B4A',
  color_primary_deep:  '#0F1B30',
  color_primary_mid:   '#2E4270',
  color_accent:        '#C9A848',
  color_accent_light:  '#E8D08A',
  color_bg:            '#F5F3EF',
  font_heading:        'Cormorant Garamond',
  font_body:           'Jost',
  // CSS2 `family=` fragments built from the picked Google Font's real weights
  // (e.g. "Fraunces:wght@400;600;700"). Empty → renderers fall back to the
  // curated map, then to the bare family name. Set by the font picker.
  font_heading_spec:   '',
  font_body_spec:      '',
  // ── Contrast / utility colors ──
  color_dark:          '#0F1B30',       // main text color
  color_white:         '#FDFCFA',       // page background / white surface
  color_muted:         '',              // secondary text (auto-computed if empty)
  color_border:        '',              // borders / dividers (auto-computed if empty)
  color_success:       '#15803D',       // success state
  color_danger:        '#8B1C1C',       // error / danger state
  // ── Head / favicon / tracking / share (global defaults, per-tenant configurable) ──
  favicon_emoji:       '',
  gtm_id:              '',
  head_html:           '',
  body_end_html:       '',
  // ── YouTube auto-feed (keyless RSS; API-ready) ──
  youtube_channel:     '',              // UC… id, @handle, handle, or channel URL
  youtube_limit:       '6',             // max videos to pull into the landing section
  youtube_tag:         '',              // only show videos whose title/description contains this marker (e.g. "#slab"); blank = latest
  // ── Landing "every feature" showcase (curated JSON; blank = seed from registry) ──
  // JSON array of { title, blurb, stage:'stable'|'beta'|'experimental', section }.
  landing_features_json: '',
  // ── Site / domain ownership verification tokens ──
  verify_google:       '',
  verify_bing:         '',
  verify_pinterest:    '',
  verify_facebook:     '',
  // ── Homepage source ── (two-value model as of the 2026-07 design-control pass)
  // 'slab'   → platform-rendered: the activated Slab template if one exists in
  //            active_template, otherwise the standard landing_layout below.
  //            This is the default and where the Template Store plugs in.
  // 'custom' → the tenant's bespoke views/tenants/<sub>/home.ejs. Falls back to
  //            'slab' rendering if that file does not exist (never a blank page).
  // Legacy values 'auto'/'layout'/'template' are migrated to slab|custom by
  // scripts/migrate-home-source.mjs and are no longer written by the UI.
  home_source:         'slab',
  vis_header:          'true',
  vis_hero:            'true',
  vis_marquee:         'true',
  vis_services:        'true',
  vis_portfolio:       'true',
  vis_about:           'true',
  vis_process:         'true',
  vis_reviews:         'true',
  vis_contact:         'true',
  vis_blog:            'false',
  vis_careers:         'false',
  vis_videos:          'true',           // YouTube auto-feed section on the landing
  vis_footer:          'true',
  vis_admin_link:      'true',
  // ── Built-in header nav links (toggle the hardcoded items on/off) ──
  vis_nav_home:        'true',          // "Home" link in the header nav
  vis_nav_blog:        'true',          // "Blog" link in the header nav
  vis_nav_cta:         'true',          // CTA button in the header nav
  // ── Custom element toggles ──
  el_bug_button:       'true',         // floating bug/ticket button
  el_notification_bell:'true',         // notification bell (platform announcements)
  el_admin_tour:       'true',         // guided admin tour (Driver.js)
  el_preview_banner:   'true',         // preview-mode top banner
  el_maintenance_banner:'true',        // maintenance cooldown banner
  el_gltf_viewer:      'false',        // 3D model viewer (heavy)
  el_design_switcher:  'false',        // public floating design-switcher (visitor repaints site live from preset palettes)
  agent_name:          'Assistant',
  agent_greeting:      'Hi! I can write blog posts, update site copy, or build new sections. What would you like to create?',
  portfolio_layout:    'grid',
  blog_layout:         'grid',
  nav_logo_display:    'text',
  nav_logo_split:      '0',
  nav_logo_split_end:  '0',            // char end for accent range (0 = use split as single point)
  nav_logo_accent_color: '',           // custom accent color for logo text (empty = use color_accent)
  // ── Logo image sizing + text/logo composition ──
  nav_logo_size:       '48',           // px — height of the nav logo image (oversize up to ~180)
  // How the logo image and brand text sit together when display = 'both':
  //   stack          → logo above text (default)
  //   inline         → logo left, text right
  //   inline-reverse → text left, logo right
  //   overlap        → text laid over the logo (use overlap_x/y to nudge)
  nav_logo_layout:     'stack',
  nav_logo_overlap_x:  '0',            // px — horizontal nudge of text over logo (overlap mode)
  nav_logo_overlap_y:  '0',            // px — vertical nudge of text over logo (overlap mode)
  // ── Brand wordmark typography ──
  nav_brand_size:        '1.4',        // rem
  nav_brand_weight:      '400',        // 300/400/500/600/700/800
  nav_brand_spacing:     '0.04',       // em
  nav_brand_transform:   'none',       // none | uppercase
  nav_brand_italic:      'false',      // italic on/off
  // ── Accent characters (inside the wordmark) ──
  nav_accent_weight:     '',           // empty = inherit brand weight
  nav_accent_italic:     'false',
  // ── Tagline typography ──
  nav_tagline_display: 'true',         // show tagline + location below brand name
  nav_tagline_size:      '0.58',       // rem
  nav_tagline_weight:    '600',
  nav_tagline_spacing:   '0.28',       // em
  nav_tagline_transform: 'uppercase',  // none | uppercase | lowercase
  nav_tagline_italic:    'false',
  nav_cta_text:        '',             // custom CTA text in nav (empty = "Get Started")
  nav_cta_link:        '',             // custom CTA link (empty = "/#contact")
  nav_bg:              '',             // custom nav background (empty = ivory/transparent)
  nav_text_color:      '',             // legacy "everything" color (used as fallback for both brand + link)
  nav_brand_color:     '',             // wordmark/brand text color (empty = nav_text_color → on-ivory)
  nav_tagline_color:   '',             // tagline subtext color (empty = primary)
  nav_link_color:      '',             // nav links resting color (empty = nav_text_color → on-ivory-muted)
  nav_link_hover_color:'',             // nav link hover/active color (empty = primary)
  nav_cta_bg:          '',             // CTA button bg (empty = inherits link styling)
  nav_cta_color:       '',             // CTA button text color (empty = inherits link styling)
  landing_layout:      'classic',
  hero_name_large:     '',
  vis_pricing:           'true',
  vis_qr:               'false',
  model_header_enabled: 'false',
  model_logo_enabled:   'false',
  // ── Hero & section styling ──
  // 'split'       → current split-panel text-typeface heavy hero (default)
  // 'slideshow'   → fading slides with dots + linkable slide CTAs (slide{N}_* copy keys)
  // 'image_card'  → static background image with a shadow card over big typeface
  hero_style:           'split',
  hero_overlay_opacity: '55',          // 0-100, darkness of overlay on hero bg image
  hero_overlay_color:   '',            // hex — defaults to color_primary_deep if empty
  hero_text_align:      'left',        // left, center, right (horizontal)
  hero_vpos:            'middle',      // top, middle, bottom — vertical position of overlaid hero text
  hero_height:          '100vh',       // 100vh, 80vh, 60vh, auto
  hero_heading_size:    '',            // rem override for hero heading (empty = responsive default)
  // ── Slideshow hero ──
  hero_slideshow_interval: '6',        // seconds between auto-advance (0 = manual only)
  hero_slideshow_dots:     'true',     // show dot indicators
  hero_slideshow_arrows:   'true',     // show prev/next arrows
  hero_slideshow_dot_color:'',         // empty → color_accent
  // When true, one static headline (the main hero copy + CTAs) is overlaid
  // across the whole slideshow instead of per-slide titles — for tenants who
  // want image-only slides under a single fixed headline.
  hero_slideshow_static:   'false',
  // ── Image-card hero (static image + shadow card) ──
  hero_card_position:   'left',        // left, center, right
  hero_card_bg:         '',            // empty → semi-opaque surface
  hero_card_text_color: '',            // empty → on_surface
  hero_card_blur:       '8',           // 0-24 px backdrop blur
  hero_card_shadow:     'true',        // drop shadow on card
  section_animation:    'fade',        // none, fade, slide, zoom, flip, stagger, blur
  // ── Scroll-snap layout ──
  snap_enabled:         'false',       // full-page snap scrolling (ACM-style)
  snap_strictness:      'proximity',   // proximity (gentle) | mandatory (hard lock)
  // ── Industrial/service styling ──
  hero_bg_pattern:      'none',        // none, grid, diagonal, dots — subtle overlay pattern
  // ── Hero full-bleed background override (image or video from tenant assets) ──
  hero_bg_media_url:    '',            // URL to image/video — overrides the split layout right-panel image
  hero_bg_media_type:   '',            // '', 'image', or 'video'
  hero_bg_media_poster: '',            // optional poster image URL for video
  card_hover_accent:    'true',        // accent-colored top border on card hover
  card_border_radius:   '2',           // 0-16 px
  // ── Color accents (secondary + tertiary for multi-brand) ──
  color_accent_2:       '',            // secondary accent (e.g. ACM Heyday gold)
  color_accent_3:       '',            // tertiary accent (e.g. ACM Graffiti lime)
  // ── Gradient backgrounds ──
  gradient_enabled:     'false',       // enable section gradient backgrounds
  gradient_angle:       '135',         // 0-360 degrees
  // ── Contact section colors ──
  contact_bg:           '',            // left panel bg (defaults to --navy-deep)
  contact_heading_color:'',            // heading color (defaults to white)
  contact_eyebrow_color:'',            // eyebrow color (defaults to --gold-light)
  contact_text_color:   '',            // sub/body text color
  contact_label_color:  '',            // detail label color (defaults to --gold)
  contact_value_color:  '',            // detail value color
  contact_form_bg:      '',            // form/right panel bg (defaults to --ivory)
  contact_form_label_color:'',         // form field label color
  contact_btn_bg:       '',            // submit button bg (defaults to --navy)
  contact_btn_color:    '',            // submit button text color
  // ── Ticker / Marquee bar ──
  ticker_items:         '',            // pipe-separated custom items (empty = use brand services/location/tagline)
  ticker_speed:         '22',          // animation duration in seconds (higher = slower)
  ticker_direction:     'left',        // left or right (scroll direction)
  ticker_bg:            '',            // background color (empty = primary)
  ticker_text_color:    '',            // text color (empty = accent-light)
  ticker_dot_color:     '',            // separator dot color (empty = accent-2)
  ticker_font_size:     '0.72',        // rem
  ticker_padding:       '14',          // px (vertical)
  ticker_uppercase:     'true',        // text-transform: uppercase
  ticker_letter_spacing:'0.2',         // em
  ticker_item_gap:      '32',          // px — gap between items
  // ── Ticker shape / vector ──
  ticker_shape:         'straight',    // straight | diagonal | arc (curved SVG path)
  ticker_angle:         '-4',          // deg — diagonal tilt (only when shape=diagonal)
  ticker_arc_height:    '40',          // px — curve rise/sag (only when shape=arc)
  // ── Ticker treatment: flat bar vs layered parallax band ──
  ticker_treatment:       'bar',       // bar | parallax (z1 image / z2 floating marquee / z3 copy)
  ticker_parallax_image:  '',          // z1 background image URL (empty → hero bg media)
  ticker_parallax_height: '70vh',      // band height (vh/px)
  ticker_parallax_overlay:'45',        // 0-100 dark overlay over the image
  ticker_band_font_size:  '5',         // rem — big floating marquee typeface size
  // ── Cookie consent (GDPR-style, category preferences) ──
  cookie_consent_enabled:  'false',    // show consent UI to visitors
  cookie_consent_style:    'modal',    // modal | banner
  cookie_consent_position: 'bottom',   // bottom | bottom-left | center
  cookie_bg:               '',         // empty → var(--surface)
  cookie_text_color:       '',         // empty → var(--on-surface)
  cookie_accent:           '',         // empty → var(--accent)
  // Placement on the Standard Layout. Templates use their own ticker block(s) for placement.
  // 'above_hero'      → above hero, sticky-pinned under nav (legacy)
  // 'below_hero'      → below hero, inline
  // 'below_services'  → below services/features (default)
  // 'below_process'   → below the "How It Works" section
  // 'fixed_top'       → fixed to viewport top, above everything
  // 'fixed_bottom'    → fixed to viewport bottom
  ticker_position:      'below_services',
  // ── Header structural layout (independent of landing_layout) ──
  // standard | compact | spacious | centered | split
  //   standard → brand left, links right (default)
  //   compact  → reduced padding, smaller wordmark
  //   spacious → tall header, large brand, more padding
  //   centered → brand centered, links flow under
  //   split    → links balanced both sides of a centered brand
  header_layout:        'standard',
  header_padding_y:     '20',          // px, vertical padding
  header_padding_x:     '52',          // px, horizontal padding
  header_sticky:        'true',        // fix to top of viewport
  header_blur:          'true',        // backdrop blur over content
  header_shadow:        'true',        // box-shadow when scrolled
  // ── Footer structural layout ──
  // simple | columns | centered | expanded | minimal | brand
  //   simple   → one-line legal + admin (default behavior today)
  //   columns  → multi-column with link sets + brand
  //   centered → brand block centered, then links + legal stacked
  //   expanded → brand + about copy + 3 link columns + newsletter
  //   minimal  → copyright only, tiny
  //   brand    → big brand + tagline + social row + copyright
  footer_layout:        'simple',
  footer_align:         'center',      // left | center | right
  footer_columns:       '3',           // 1-4
  footer_padding_y:     '32',          // px
  footer_padding_x:     '24',          // px
  footer_show_brand:    'true',        // render brand wordmark in footer
  footer_show_tagline:  'true',        // render tagline under brand
  footer_show_logo:     'false',       // render uploaded logo image
  footer_show_social:   'true',        // render social link row
  footer_show_newsletter:'true',       // render newsletter signup (auto-wired list capture)
  footer_show_qr:       'true',        // render the QR codes block
  // ── Footer typography ──
  footer_heading_size:  '0.72',        // rem — column headings
  footer_heading_weight:'600',
  footer_heading_transform:'uppercase',
  footer_heading_spacing:'0.12',       // em
  footer_text_size:     '0.78',        // rem — body/copyright
  footer_text_weight:   '400',
  footer_brand_size:    '1.2',         // rem — footer wordmark
  footer_brand_weight:  '500',
  // ── Footer colors ──
  footer_bg:            '',            // empty → layout-driven default
  footer_text_color:    '',            // empty → muted on bg
  footer_heading_color: '',            // empty → primary/accent
  footer_link_color:    '',            // empty → text color
  footer_link_hover_color:'',          // empty → accent
  footer_border_color:  '',            // top border / dividers
  footer_accent_color:  '',            // empty → color_accent
  // ── Footer social links (kept on design, not copy — they're URLs not prose) ──
  footer_social_facebook:  '',
  footer_social_instagram: '',
  footer_social_twitter:   '',
  footer_social_linkedin:  '',
  footer_social_youtube:   '',
  footer_social_tiktok:    '',
  footer_social_github:    '',
};

// ── Theme-saveable design keys (excludes agent settings / visibility) ──
export const THEME_KEYS = [
  'color_primary', 'color_primary_deep', 'color_primary_mid',
  'color_accent', 'color_accent_light', 'color_bg',
  'color_accent_2', 'color_accent_3',
  'color_dark', 'color_white', 'color_muted', 'color_border',
  'color_success', 'color_danger',
  'font_heading', 'font_body',
  'portfolio_layout', 'blog_layout', 'nav_logo_display', 'nav_logo_split',
  'nav_logo_size', 'nav_logo_layout', 'nav_logo_overlap_x', 'nav_logo_overlap_y', 'landing_layout',
  'hero_style', 'hero_overlay_opacity', 'hero_text_align', 'hero_vpos', 'hero_height', 'hero_heading_size',
  'hero_slideshow_interval', 'hero_slideshow_dots', 'hero_slideshow_arrows', 'hero_slideshow_dot_color',
  'hero_slideshow_static',
  'hero_card_position', 'hero_card_bg', 'hero_card_text_color', 'hero_card_blur', 'hero_card_shadow',
  'snap_enabled', 'snap_strictness', 'gradient_enabled', 'gradient_angle',
  'hero_bg_pattern', 'card_hover_accent', 'card_border_radius',
  'hero_bg_media_url', 'hero_bg_media_type', 'hero_bg_media_poster',
  'section_animation',
  // ticker style tokens (items themselves stay per-tenant/content)
  'ticker_speed', 'ticker_direction', 'ticker_bg', 'ticker_text_color',
  'ticker_dot_color', 'ticker_font_size', 'ticker_padding',
  'ticker_uppercase', 'ticker_letter_spacing', 'ticker_item_gap',
  'ticker_position', 'ticker_shape', 'ticker_angle', 'ticker_arc_height',
  'ticker_treatment', 'ticker_parallax_image', 'ticker_parallax_height',
  'ticker_parallax_overlay', 'ticker_band_font_size',
  // cookie consent style tokens (copy/text lives in copy collection)
  'cookie_consent_enabled', 'cookie_consent_style', 'cookie_consent_position',
  'cookie_bg', 'cookie_text_color', 'cookie_accent',
  // header + footer structural / style tokens (not URLs/social handles)
  'header_layout', 'header_padding_y', 'header_padding_x',
  'header_sticky', 'header_blur', 'header_shadow',
  'footer_layout', 'footer_align', 'footer_columns',
  'footer_padding_y', 'footer_padding_x',
  'footer_show_brand', 'footer_show_tagline', 'footer_show_logo',
  'footer_show_social', 'footer_show_newsletter', 'footer_show_qr',
  'footer_heading_size', 'footer_heading_weight',
  'footer_heading_transform', 'footer_heading_spacing',
  'footer_text_size', 'footer_text_weight',
  'footer_brand_size', 'footer_brand_weight',
  'footer_bg', 'footer_text_color', 'footer_heading_color',
  'footer_link_color', 'footer_link_hover_color',
  'footer_border_color', 'footer_accent_color',
];

// Copy section field map — shared with copy.js
export const COPY_SECTIONS = {
  hero: ['hero_eyebrow', 'hero_heading', 'hero_heading_em', 'hero_sub', 'hero_badge',
         'hero_cta_primary', 'hero_cta_primary_link', 'hero_cta_secondary', 'hero_cta_secondary_link'],
  services: ['services_label', 'services_heading', 'services_heading_em', 'services_sub',
             'service1_title', 'service1_desc', 'service1_link', 'service1_image',
             'service2_title', 'service2_desc', 'service2_link', 'service2_image',
             'service3_title', 'service3_desc', 'service3_link', 'service3_image'],
  about: ['about_quote', 'about_desc', 'about_sig', 'about_eyebrow', 'about_initial',
         'about_stat1_num', 'about_stat1_label', 'about_stat2_num', 'about_stat2_label',
         'about_stat3_num', 'about_stat3_label', 'about_stat4_num', 'about_stat4_label'],
  process: ['process_label', 'process_heading', 'process_heading_em',
           'process1_title', 'process1_desc', 'process2_title', 'process2_desc',
           'process3_title', 'process3_desc', 'process4_title', 'process4_desc'],
  pricing: ['startup_price_heading', 'startup_price_desc', 'startup_price_cta', 'startup_price_note',
           'startup_price_amount', 'startup_price_unit', 'startup_price_label', 'startup_price_features',
           'pricing_tier2_amount', 'pricing_tier2_unit', 'pricing_tier2_label', 'pricing_tier2_equiv',
           'pricing_tier2_cta_link',
           'pricing_tier3_amount', 'pricing_tier3_unit', 'pricing_tier3_label', 'pricing_tier3_equiv',
           'pricing_tier3_featured', 'pricing_tier3_cta_link',
           'pricing_tier4_amount', 'pricing_tier4_unit', 'pricing_tier4_label', 'pricing_tier4_equiv',
           'pricing_tier4_cta_link',
           'promo_enabled', 'promo_badge', 'promo_heading', 'promo_text'],
  contact: ['contact_eyebrow', 'contact_heading', 'contact_heading_em',
           'contact_sub', 'contact_location', 'contact_location_label',
           'contact_serving', 'contact_serving_label',
           'contact_services', 'contact_services_label',
           'contact_btn', 'contact_fname_label', 'contact_fname_placeholder',
           'contact_lname_label', 'contact_lname_placeholder',
           'contact_email_label', 'contact_email_placeholder',
           'contact_company_label', 'contact_company_placeholder',
           'contact_service_label', 'contact_service_placeholder',
           'contact_message_label', 'contact_message_placeholder',
           'contact_service_fallback', 'contact_service_extra',
           // Per-field visibility toggles (checkbox; empty = visible, 'true' = hidden)
           'contact_fname_hidden', 'contact_lname_hidden', 'contact_email_hidden',
           'contact_company_hidden', 'contact_service_hidden', 'contact_message_hidden'],
  footer: [
    // Brand / about
    'footer_tagline', 'footer_about', 'footer_copyright', 'footer_legal',
    // Column 1 — heading + pipe-separated label|url pairs (one per line)
    'footer_col1_heading', 'footer_col1_links',
    'footer_col2_heading', 'footer_col2_links',
    'footer_col3_heading', 'footer_col3_links',
    'footer_col4_heading', 'footer_col4_links',
    // Newsletter
    'footer_newsletter_heading', 'footer_newsletter_sub',
    'footer_newsletter_placeholder', 'footer_newsletter_button',
    // Careers CTA — dedicated "we're hiring" card (shown when careers is visible)
    'footer_careers_heading', 'footer_careers_sub', 'footer_careers_button',
    // CTA / social label
    'footer_social_heading',
  ],
  cookie: ['cookie_title', 'cookie_message',
           'cookie_accept_label', 'cookie_reject_label', 'cookie_save_label',
           'cookie_settings_label',
           'cookie_necessary_title', 'cookie_necessary_desc',
           'cookie_analytics_title', 'cookie_analytics_desc',
           'cookie_marketing_title', 'cookie_marketing_desc',
           'cookie_privacy_text', 'cookie_privacy_link'],
  marquee: ['ticker_band_heading', 'ticker_band_text', 'ticker_band_cta', 'ticker_band_cta_link'],
};
