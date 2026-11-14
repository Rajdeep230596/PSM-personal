// Remaining audit corrections: page copy, form consent, privacy links,
// styles and server headers. No layout or image changes.
import fs from "node:fs";

const out = [];
const edit = (file, pairs) => {
  let s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  let n = 0;
  for (const [label, from, to] of pairs) {
    if (!s.includes(from)) {
      out.push(`MISS ${file} :: ${label}`);
      continue;
    }
    s = s.replace(from, to);
    n += 1;
  }
  fs.writeFileSync(file, s, "utf8");
  out.push(`${file}: ${n}/${pairs.length} applied`);
};

edit("index.html", [
  [
    "lazy shot-3",
    `src="assets/shot-3.jpg?v=1" fetchpriority="low"`,
    `src="assets/shot-3.jpg?v=1" fetchpriority="low" loading="lazy"`,
  ],
  [
    "lazy shot-4",
    `src="assets/shot-4.jpg?v=1" fetchpriority="low"`,
    `src="assets/shot-4.jpg?v=1" fetchpriority="low" loading="lazy"`,
  ],
  [
    "how we work",
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
          <button class="connect-cta" id="connect" type="button">Request a Private Consultation</button>`,
  ],
  [
    "form consent",
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
          <button class="ipad-send" type="submit">Request a Private Consultation</button>`,
  ],
  [
    "address 01",
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
                </p>`,
  ],
  [
    "address 02",
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
                </p>`,
  ],
  [
    "vendor note",
    `            <h2>Houses we trust.</h2>
          </div>`,
    `            <h2>Houses we trust.</h2>
            <p class="vendor-note">
              Houses we have sourced from or worked alongside. Nothing here implies an official
              partnership, dealership or endorsement.
            </p>
          </div>`,
  ],
  [
    "footer privacy",
    `            <p>© <span id="year"></span> PSM Infinity. All rights reserved.</p>`,
    `            <p>© <span id="year"></span> PSM Infinity. All rights reserved. <a href="privacy.html">Privacy notice</a></p>`,
  ],
]);

edit("main.js", [
  [
    "honeypot + consent",
    `  const data = new FormData(form);
  const lines = [`,
    `  const data = new FormData(form);
  if (String(data.get("company") || "").trim()) {
    status.textContent = "Thank you. Your enquiry has been noted.";
    return;
  }
  const lines = [`,
  ],
  [
    "submitted confirmation",
    `  status.textContent = "WhatsApp is opening.";`,
    `  status.textContent = "Your enquiry is ready in WhatsApp. Press send there and we will reply personally.";`,
  ],
]);

fs.writeFileSync(
  "styles.extra.css",
  `/* Audit additions: privacy consent, enquiry link, vendor clarification.
   These reuse the existing type scale so nothing is restyled. */
.nav-enquire {
  color: var(--gold, #c8a96a);
}

.vendor-note {
  max-width: 46ch;
  margin-top: 0.9rem;
  font-size: 0.78rem;
  line-height: 1.5;
  opacity: 0.66;
}

.consent {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  margin: 1.1rem 0 0.2rem;
  font-size: 0.78rem;
  line-height: 1.5;
}

.consent input {
  margin-top: 0.2rem;
  accent-color: #c8a96a;
}

.consent a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.hp-field {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.interlude .kicker {
  margin-bottom: 0.7rem;
}

/* Plain reading page for the privacy notice, using the site's own tokens. */
.privacy-page {
  max-width: 62ch;
  margin: 0 auto;
  padding: 14vh 1.6rem 18vh;
  font-family: var(--sans, system-ui, sans-serif);
  line-height: 1.7;
  color: #eee;
}

.privacy-page h1 {
  font-size: clamp(1.7rem, 5vw, 2.6rem);
  margin-bottom: 0.4rem;
}

.privacy-page h2 {
  font-size: 1.05rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 2rem 0 0.6rem;
  opacity: 0.8;
}

.privacy-page p,
.privacy-page li {
  font-size: 0.95rem;
  color: rgba(238, 238, 238, 0.82);
}

.privacy-page ul {
  padding-left: 1.1rem;
}

.privacy-page a {
  color: #c8a96a;
}

.privacy-page .back {
  display: inline-block;
  margin-top: 2.4rem;
  font-size: 0.85rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
`,
  "utf8"
);
out.push("styles.extra.css written");

const htaccess = fs.readFileSync(".htaccess", "utf8");
const security = `
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Permissions-Policy "geolocation=(), camera=(), microphone=()"
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
</IfModule>

# Text assets compress; media must not (gzip breaks video range requests).
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE application/ld+json application/xml text/xml
</IfModule>
`;
if (!htaccess.includes("X-Content-Type-Options")) {
  fs.writeFileSync(".htaccess", htaccess + security, "utf8");
  out.push(".htaccess: security headers added");
} else {
  out.push(".htaccess: already patched");
}

console.log(out.join("\n"));
