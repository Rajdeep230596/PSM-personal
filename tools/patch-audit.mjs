// One-off patch applying the audit's non-visual corrections to index.html.
// Keeps every existing section, layout and image; only metadata, headings,
// copy and attributes change.
import fs from "node:fs";

const path = "index.html";
let s = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const before = s;
const applied = [];
const sub = (label, from, to) => {
  if (!s.includes(from)) {
    applied.push(`MISS ${label}`);
    return;
  }
  s = s.replace(from, to);
  applied.push(`ok   ${label}`);
};

const HEAD = `    <title>PSM INFINITY | Private Luxury &amp; Global Concierge Services in Kolkata</title>
    <meta
      name="description"
      content="PSM INFINITY is a private luxury concierge in Kolkata led by Sunandan Mitra: lifestyle management, international travel, executive assistance, luxury sourcing and exclusive experiences."
    />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="author" content="Sunandan Mitra" />
    <meta name="geo.region" content="IN-WB" />
    <meta name="geo.placename" content="Kolkata" />
    <meta property="og:site_name" content="PSM INFINITY" />
    <meta property="og:locale" content="en_IN" />
    <meta property="og:title" content="PSM INFINITY | Private Luxury &amp; Global Concierge Services" />
    <meta
      property="og:description"
      content="Private, personalised concierge services for lifestyle, travel, executive assistance, luxury sourcing and exclusive experiences."
    />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://www.psminfinity.com/" />
    <meta property="og:image" content="https://www.psminfinity.com/assets/poster.jpg" />
    <meta property="og:image:alt" content="PSM INFINITY private luxury concierge" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="PSM INFINITY | Private Luxury &amp; Global Concierge Services" />
    <meta
      name="twitter:description"
      content="Private, personalised concierge services for lifestyle, travel, executive assistance, luxury sourcing and exclusive experiences."
    />
    <meta name="twitter:image" content="https://www.psminfinity.com/assets/poster.jpg" />
    <link rel="icon" href="assets/mark.webp" type="image/webp" />
    <link rel="apple-touch-icon" href="assets/mark.webp" />
    <link rel="canonical" href="https://www.psminfinity.com/" />
    <meta name="theme-color" content="#090a0c" />
    <link rel="preload" href="assets/fonts/cormorant-500.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="assets/fonts/cormorant-italic.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="assets/fonts/outfit.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="assets/shot-1.jpg?v=1" as="image" fetchpriority="high" />
    <link rel="modulepreload" href="film-engine.js?v=9" />
`;

const OLD_HEAD = `    <title>PSM Infinity — Sunandan Mitra | Premium Visual Experiences</title>
    <meta
      name="description"
      content="PSM Infinity by Sunandan Mitra — a discreet, personalised concierge for lifestyle, travel, events, and the details that matter. Based in Kolkata, India."
    />
    <meta property="og:title" content="PSM Infinity — Your World. Personally Curated." />
    <meta
      property="og:description"
      content="Private. Personal. Precise. A personalised concierge by Sunandan Mitra."
    />
    <meta property="og:type" content="website" />
    <link rel="icon" href="assets/mark.webp" type="image/webp" />
    <link rel="canonical" href="https://www.psminfinity.com/" />
    <meta name="theme-color" content="#090a0c" />
    <link rel="preload" href="assets/fonts/cormorant-500.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="assets/fonts/cormorant-italic.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="assets/fonts/outfit.woff2" as="font" type="font/woff2" crossorigin />
`;
sub("head metadata", OLD_HEAD, HEAD);

// The tier bootstrap no longer preloads the motion tier (it is not shipped)
// and asks for two opening frames instead of six, so the hero poster is not
// competing with a dozen low-value requests on a throttled phone.
sub(
  "tier bootstrap",
  `        for (var i = 0; i < 6; i += 1) {
          var link = document.createElement("link");
          link.rel = "preload";
          link.as = "image";
          link.setAttribute("href", "assets/frames/" + tier + "/shot-1/00" + i + ".webp?v=4");
          if (i < 4) link.setAttribute("fetchpriority", "high");
          document.head.appendChild(link);
          if (i < 2) {
            var light = document.createElement("link");
            light.rel = "preload";
            light.as = "image";
            light.setAttribute("href", "assets/frames/motion/shot-1/00" + i + ".webp?v=4");
            document.head.appendChild(light);
          }
        }`,
  `        for (var i = 0; i < 2; i += 1) {
          var link = document.createElement("link");
          link.rel = "preload";
          link.as = "image";
          link.setAttribute("href", "assets/frames/" + tier + "/shot-1/00" + i + ".webp?v=5");
          link.setAttribute("fetchpriority", "high");
          document.head.appendChild(link);
        }`
);

sub("stylesheet link", `<link rel="stylesheet" href="styles.css?v=63" />`, `<link rel="stylesheet" href="styles.min.css?v=64" />`);

sub(
  "structured data",
  `  </head>`,
  `    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "ProfessionalService",
        "@id": "https://www.psminfinity.com/#organisation",
        "name": "PSM INFINITY",
        "alternateName": "PSM Infinity Private Concierge",
        "url": "https://www.psminfinity.com/",
        "description": "Private luxury concierge offering lifestyle management, international travel, executive assistance, luxury sourcing and exclusive experiences from Kolkata, India.",
        "founder": { "@type": "Person", "name": "Sunandan Mitra" },
        "telephone": "+91-90073-31000",
        "email": "psminfinity@gmail.com",
        "address": {
          "@type": "PostalAddress",
          "addressLocality": "Kolkata",
          "addressRegion": "West Bengal",
          "postalCode": "700019",
          "addressCountry": "IN"
        },
        "areaServed": [
          { "@type": "City", "name": "Kolkata" },
          { "@type": "Country", "name": "India" },
          { "@type": "Place", "name": "Worldwide" }
        ],
        "sameAs": [
          "https://www.instagram.com/psminfinity",
          "https://www.facebook.com/share/1EX2K8nfWi/",
          "https://youtube.com/@psminfinity1112",
          "https://t.me/psminfinity"
        ],
        "hasOfferCatalog": {
          "@type": "OfferCatalog",
          "name": "Concierge services",
          "itemListElement": [
            { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Corporate & Executive Concierge" } },
            { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "International Lifestyle Assistance" } },
            { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Personal Shopping & Luxury Sourcing" } },
            { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Exclusive Events & Experiences" } },
            { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Lifestyle & Household Management" } },
            { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Security & Housekeeping" } }
          ]
        }
      }
    </script>
  </head>`
);

sub("nav enquire", `<a href="#connect">Contact</a>`, `<a href="#connect">Contact</a>\n          <a class="nav-enquire" href="#contact">Enquire</a>`);

sub(
  "h1",
  `        <h1>Hi, this is Sunandan Mitra</h1>
        <p class="interlude-lead">Welcome to PSM Infinity</p>`,
  `        <p class="kicker">Hi, this is Sunandan Mitra</p>
        <h1>Private Luxury Concierge</h1>
        <p class="interlude-lead">Your world, personally curated — in Kolkata and worldwide</p>`
);

sub(
  "intro copy",
  `<h2>Your world</h2>
        <h2>Personally curated</h2>`,
  `<h2>Your world</h2>
        <h2>Personally curated</h2>
        <p class="interlude-lead">Lifestyle, travel and the arrangements that hold a day together.</p>`
);

// Lazy-load the posters for reels that are not on the opening screen.
sub(
  `src="assets/shot-3.jpg?v=1" fetchpriority="low"`,
  `src="assets/shot-3.jpg?v=1" fetchpriority="low" loading="lazy"`
);
sub(
  `src="assets/shot-4.jpg?v=1" fetchpriority="low"`,
  `src="assets/shot-4.jpg?v=1" fetchpriority="low" loading="lazy"`
);

// Philosophy, engagement process and confidentiality, inside the existing
// about layout and its existing card styles.
sub(
  `          <button class="connect-cta" id="connect" type="button">Connect With Us</button>`,
  `          <section class="about-screen" id="how" aria-label="How we work">
            <p class="kicker">How we work</p>
            <h2>Discretion is the service</h2>
            <p class="motto">One named contact. A small number of households.</p>
            <ul class="timeline">
              <li>
                <strong>Enquiry</strong>
                <span>A short note or call, with no obligation attached.</span>
              </li>
              <li>
                <strong>Briefing</strong>
                <span>We agree scope, availability and the standard you expect.</span>
              </li>
              <li>
                <strong>Engagement</strong>
                <span>A confidential retainer, with requests by phone, WhatsApp or email.</span>
              </li>
            </ul>
            <p>
              Client names, itineraries and purchases are never published, never used as
              references, and never passed on without your consent. We arrange and coordinate on
              your behalf; we do not act as an agent for any brand and we do not take commissions.
            </p>
          </section>
          <button class="connect-cta" id="connect" type="button">Request a Private Consultation</button>`
);

sub(
  `          <p class="form-status" id="form-status" role="status"></p>
          <button class="ipad-send" type="submit">Send</button>`,
  `          <label class="consent">
            <input type="checkbox" name="consent" value="yes" required />
            <span>
              I agree to PSM Infinity using these details to respond to my enquiry, as described in
              the <a href="privacy.html">privacy notice</a>.
            </span>
          </label>
          <label class="hp-field" aria-hidden="true">
            <span>Company</span>
            <input name="company" type="text" tabindex="-1" autocomplete="off" />
          </label>
          <p class="form-status" id="form-status" role="status" aria-live="polite"></p>
          <button class="ipad-send" type="submit">Request a Private Consultation</button>`
);

// Residential addresses reduced to an appointment-only line: the audit's
// privacy finding, with no change to the layout.
sub(
  `                <p class="kicker">Address 01</p>
                <p>
                  Mr Sunandan Mitra<br />
                  29 Palit Street, Flat 3A (Amritkunj)<br />
                  Opposite Maddox Square Park, North Gate<br />
                  Kolkata 700019, West Bengal, India
                </p>`,
  `                <p class="kicker">Kolkata</p>
                <p>
                  By appointment<br />
                  Ballygunge, Kolkata 700019<br />
                  West Bengal, India
                </p>`
);
sub(
  `                <p class="kicker">Address 02</p>
                <p>
                  Mr Sunandan Mitra<br />
                  Diamond City South, 58 Mahatma Gandhi Road<br />
                  Tower 1, 18C, Tollygunge<br />
                  Kolkata 700041, West Bengal, India
                </p>`,
  `                <p class="kicker">Correspondence</p>
                <p>
                  Mr Sunandan Mitra<br />
                  PSM INFINITY<br />
                  Kolkata, West Bengal, India<br />
                  Meetings by appointment only
                </p>`
);

sub(
  `            <h2>Houses we trust.</h2>
          </div>`,
  `            <h2>Houses we trust.</h2>
            <p class="vendor-note">
              Houses we have sourced from or worked alongside. Nothing here implies an official
              partnership, dealership or endorsement.
            </p>
          </div>`
);

sub(
  `            <p>© <span id="year"></span> PSM Infinity. All rights reserved.</p>`,
  `            <p>© <span id="year"></span> PSM Infinity. All rights reserved.</p>
            <p><a href="privacy.html">Privacy notice</a></p>`
);

sub("engine version", `film-engine.js?v=8`, `film-engine.js?v=9`);
sub("main version", `main.js?v=136`, `main.js?v=137`);

fs.writeFileSync(path, s, "utf8");
console.log(applied.join("\n"));
console.log(`changed: ${before !== s}`);
