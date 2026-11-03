// Privacy, terms, refunds and contact pages. Bodies are HTML, rendered by
// scripts/build.mjs into the prose layout. Keep them in line with what the
// Worker does: a change to what is sent, stored or charged needs a change here.

export const CONTACT = 'support@anyredact.app';
export const UPDATED = '27 October 2026';

const mail = `<a href="mailto:${CONTACT}">${CONTACT}</a>`;

export const LEGAL = [
  {
    slug: 'privacy',
    nav: 'Privacy',
    title: 'Privacy Policy | AnyRedact',
    description: 'Files open in your browser, content is sent for AI detection only after you confirm, and nothing you redact is stored. Read about our processors and your rights.',
    h1: 'Privacy policy',
    body: `
<h2>How your files are handled</h2>
<p>Your files are opened, previewed, and redacted directly in your browser. The final redacted file is built on your device and is never uploaded to our servers.</p>
<p>To detect personal information automatically, AnyRedact sends only the necessary parts of a file to our server—and only after you click Upload in the editor:</p>
<ul>
<li>extracted text from documents, spreadsheets, presentations, and images for AI entity detection;</li>
<li>downscaled page or embedded images, only if you enable road sign or number plate detection;</li>
<li>speech from audio recordings, converted in your browser into short, low-bitrate mono WAV chunks;</li>
<li>extracted text with your chosen redactions already masked, if you run the optional final check before downloading.</li>
</ul>
<p>This data is sent over HTTPS to our Cloudflare Worker and analyzed in memory by AI models on Cloudflare Workers AI. Audio chunks are transcribed by Microsoft Azure AI Speech (with Cloudflare Workers AI as a fallback), which processes the audio in memory without retaining it. We never store your file content or detection results, never write them to logs, and never use them to train AI models. If you choose not to upload, nothing leaves your browser and you can still redact manually.</p>
<p>Scanned pages and images are read locally in your browser using the Tesseract OCR engine. Face and screen detection also runs locally in your browser using MediaPipe, without uploading any images. Both engines are downloaded directly by your browser from the jsDelivr CDN.</p>

<h2>Data we store</h2>
<ul>
<li><strong>Free daily allowance.</strong> Your browser stores a random device ID in local storage. Each day, we count how many free credits that ID and your IP network have used.</li>
<li><strong>Account details.</strong> If you sign in, we store your email address, your Google account ID (if you sign in with Google), your subscription plan, your credit balances, purchase records, active sign-in sessions, and an activity log of credit usage (recording only the file format, size in pages or minutes, credits used, and date—never file names or contents).</li>
<li><strong>Payments.</strong> Stripe processes all payments and stores your payment method details. We receive only your Stripe customer ID and purchase metadata.</li>
<li><strong>Security logs.</strong> Cloudflare retains short-lived HTTP request logs (such as IP addresses, request URLs, and error codes) for security and abuse prevention.</li>
<li><strong>Analytics.</strong> Google Analytics measures aggregate page views. Each page view reports only the URL path (with query strings and URL hashes stripped), the static page title, browser/device type, and approximate geographic region. File names, file contents, and detected items are never sent.</li>
</ul>
<p>We do not sell personal data and we do not run advertisements.</p>

<h2>Cookies and local storage</h2>
<p>Signing in sets an <code>HttpOnly</code> session cookie for 30 days alongside a lightweight hint cookie so the header knows you are signed in. Signing in with Google also sets a short-lived cookie to protect the OAuth login flow. Local storage holds your random free-allowance ID and UI preferences such as color theme and cookie consent. These are strictly necessary to operate the site.</p>
<p>Google Analytics sets <code>_ga</code> cookies lasting up to 2 years. For visitors in the EU, EEA, UK, and Switzerland, analytics cookies are set only if you click Accept in the cookie banner; otherwise, page views are counted cookielessly. Elsewhere, analytics cookies are enabled unless you opt out. You can review or change your choice anytime via the Cookie settings link in the footer, and declining immediately deletes existing <code>_ga</code> cookies.</p>

<h2>Subprocessors</h2>
<ul>
<li><strong>Cloudflare</strong> hosts the website and Worker API, runs text and vision AI models, sends sign-in emails, and uses Turnstile to block automated abuse before a signed-out browser’s first free scan of the day and before sending sign-in links.</li>
<li><strong>Microsoft</strong> transcribes spoken audio in recordings via Azure AI Speech.</li>
<li><strong>Stripe</strong> processes payments, subscriptions, invoices, and refunds.</li>
<li><strong>Google</strong> authenticates optional Google sign-ins and provides Google Analytics (configured with Google signals and ad personalization disabled).</li>
<li><strong>jsDelivr</strong> delivers client-side OCR and on-device vision model assets to your browser.</li>
</ul>
<p>These providers may process data outside your country under standard contractual clauses or equivalent international transfer safeguards.</p>

<h2>Purpose and legal basis</h2>
<p>We process this data to deliver the redaction service you request, meter free and paid usage, process payments, and prevent abuse. We use analytics to understand which pages and guides are most helpful. Under GDPR, our legal bases are performance of a contract, our legitimate interest in keeping the service secure and fair, your consent for analytics cookies where required by law, and compliance with legal obligations such as tax and accounting rules.</p>

<h2>Data retention</h2>
<p>File content is discarded from memory as soon as each request finishes. Free daily usage counters reset the next day. Email sign-in links expire after 15 minutes, and login sessions expire after 30 days. Account records remain until you delete your account. Payment records are retained as long as required by tax law. Google Analytics event data is retained for 2 months.</p>

<h2>Your privacy rights</h2>
<p>You can permanently delete your account at any time from your <a href="/account">account page</a>. To request a copy of your personal data, ask for a correction, or object to processing, email ${mail} from the address associated with your account. You also have the right to lodge a complaint with your local data protection authority.</p>

<h2>Children</h2>
<p>AnyRedact is not directed at children under 16. If you believe a child has provided us with personal data, please contact us so we can delete it promptly.</p>

<h2>Changes to this policy</h2>
<p>When we update this policy, we will post the revised version on this page and update the date below. If a change materially affects how your files or personal data are handled, we will notify account holders by email.</p>`,
  },
  {
    slug: 'terms',
    nav: 'Terms',
    title: 'Terms of Service | AnyRedact',
    description: 'Terms of service for using AnyRedact: daily free credits, subscriptions and credit packs, your responsibility to review redacted files, and limits of liability.',
    h1: 'Terms of service',
    body: `
<p>These Terms of Service govern your use of anyredact.app. By using AnyRedact, you agree to these terms.</p>

<h2>The service</h2>
<p>AnyRedact uses AI and browser-based tools to help you detect and remove personal or sensitive information from documents, images, spreadsheets, presentations, text files, and audio recordings. We may add, modify, or discontinue features at any time.</p>

<h2>Review every redacted file</h2>
<p>Automated detection is an aid, not a guarantee: AI models and OCR can miss sensitive details or flag text that is harmless. You choose what to redact, and you are solely responsible for inspecting every downloaded file before sharing or publishing it. AnyRedact does not provide legal advice and does not guarantee compliance with any law, court rule, or regulation.</p>

<h2>Your files and permissions</h2>
<p>You retain all rights to your files. By choosing to scan a file, you grant us permission to process the data your browser submits solely to provide the redaction service to you. You confirm that you have the legal right and authority to process the files you open.</p>

<h2>Accounts</h2>
<p>No account is required for free daily use. An account is needed only to purchase a subscription plan or pay-as-you-go credits. Keep access to your email inbox or Google account secure, as it controls access to your AnyRedact account. You must be at least 18 years old to make purchases.</p>

<h2>Credits and subscriptions</h2>
<ul>
<li>Every browser receives a free daily credit allowance. Unused free credits expire at midnight UTC and do not roll over.</li>
<li>Monthly subscription plans renew automatically each month until canceled via <strong>Manage plan and invoices</strong> on your <a href="/account">account page</a>. Plan credits reset at each billing cycle and expire when the plan ends.</li>
<li>Pay-as-you-go credit packs are one-time purchases and never expire.</li>
<li>Usage draws from today’s free allowance first, then your active monthly plan, and finally your pay-as-you-go credits.</li>
<li>Credits have no cash value and are non-transferable.</li>
<li>All prices are listed in US dollars on our <a href="/pricing">pricing page</a>.</li>
</ul>
<p>Refund eligibility is set out in our <a href="/refunds">refund policy</a>.</p>

<h2>Acceptable use</h2>
<p>You may not use AnyRedact to violate any law or third-party rights, bypass free usage limits, probe, overload, or disrupt the service, resell automated access, or submit prompts designed to manipulate or extract behavior from our AI models. We may suspend or terminate accounts that violate these terms without refunding credits spent in breach.</p>

<h2>Intellectual property</h2>
<p>The AnyRedact website, software, branding, and documentation belong to AnyRedact. All rights are reserved.</p>

<h2>Disclaimer of warranties</h2>
<p>AnyRedact is provided "as is" and "as available" without warranties of any kind, whether express or implied. We do not warrant that detection will catch all sensitive information, that the service will be uninterrupted or error-free, or that it will meet any specific compliance requirement.</p>

<h2>Limitation of liability</h2>
<p>To the maximum extent permitted by law, AnyRedact shall not be liable for any indirect, incidental, special, or consequential damages, or for any loss or harm resulting from unredacted information remaining in a file you share. Our total aggregate liability for any claim arising out of the service is limited to the amount you paid us in the 12 months preceding the claim. Nothing in these terms limits mandatory consumer rights that cannot be waived by contract.</p>

<h2>Changes to these terms</h2>
<p>We may update these terms from time to time, with the revised version taking effect on the date shown below. If an update materially reduces your rights, we will give advance notice by email to account holders.</p>

<h2>Contact</h2>
<p>If you have questions about these terms, please contact us at ${mail}.</p>`,
  },
  {
    slug: 'refunds',
    nav: 'Refunds',
    title: 'Refund Policy | AnyRedact',
    description: 'AnyRedact refund policy: 14-day refunds on unused credits and plans, cancel subscriptions anytime, and full refunds for billing errors.',
    h1: 'Refund policy',
    body: `
<h2>Pay-as-you-go credits</h2>
<p>Within 14 days of purchasing a credit pack, you can request a refund for any credits you haven’t used yet. We will refund the proportional price of the unused credits and deduct them from your balance.</p>

<h2>Monthly plans</h2>
<p>You can cancel a monthly subscription anytime via <strong>Manage plan and invoices</strong> on your <a href="/account">account page</a>. Once canceled, your plan will not renew, and you can continue using your remaining monthly credits until the end of the current billing period. If you request a refund within 14 days of a subscription charge and haven’t used any plan credits from that billing period, we will refund the payment in full and end the subscription immediately.</p>

<h2>Billing errors</h2>
<p>Duplicate charges or accidental charges occurring after cancellation are always refunded in full.</p>

<h2>How to request a refund</h2>
<p>Email <a href="mailto:support@anyredact.app?subject=Refund">support@anyredact.app</a> from the email address linked to your account and let us know which payment you would like refunded. Refunds are issued back to your original payment method via Stripe and typically appear on your statement within 5 to 10 business days.</p>

<h2>Payment disputes and chargebacks</h2>
<p>If a payment is disputed through your bank or card issuer, the credits granted by that payment are deducted while the dispute is open, and a disputed subscription charge immediately cancels the plan. Please reach out to us at ${mail} first—we’re happy to resolve billing issues directly and much faster.</p>`,
  },
  {
    slug: 'contact',
    nav: 'Contact',
    title: 'Contact | AnyRedact',
    description: 'Contact AnyRedact for product support, billing questions, refund requests, privacy inquiries, or security reports.',
    h1: 'Contact',
    dated: false,
    body: `
<p>For product support, billing questions, refunds, privacy requests, or security reports, email us at ${mail}.</p>
<p>If you’re writing about your account or a payment, please email us from the address you use to sign in. For your own privacy, please do not attach sensitive or unredacted documents to support emails.</p>`,
  },
];
