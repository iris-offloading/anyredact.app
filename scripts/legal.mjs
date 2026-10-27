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
    description: 'What AnyRedact sends to its servers, what it keeps, and who processes it: files open in your browser, content goes to AI only after you agree, and nothing you redact is stored.',
    h1: 'Privacy policy',
    body: `
<h2>Your files</h2>
<p>Files are opened, previewed and redacted in your browser. The redacted copy is created on your device and never uploaded.</p>
<p>To find personal information, AnyRedact sends part of the file to our server after you agree in the editor:</p>
<ul>
<li>the text read from the file, for detection;</li>
<li>page images, if you turn on picture redaction;</li>
<li>the speech in a recording, as low-quality mono sound in parts of a few minutes;</li>
<li>the text with your redactions blacked out, if you run the final check.</li>
</ul>
<p>The content goes over HTTPS to our Cloudflare Worker and is analysed by AI models running on Cloudflare Workers AI. It is held in memory for that request only. We do not store it or the results, do not log it, and do not use it to train models. If you decline, nothing is sent and you can redact by hand.</p>
<p>Scanned pages and images are read with the Tesseract OCR engine in your browser. Picture redaction also runs a face and object detector in your browser first. The browser downloads both from the jsDelivr CDN.</p>

<h2>Data we keep</h2>
<ul>
<li><strong>Free allowance.</strong> Your browser keeps a random ID in local storage. For each day, we count how many credits that ID and your IP address used.</li>
<li><strong>Account.</strong> If you sign in, we keep your email address, your Google account ID if you use Google, your plan, your credit balances, your purchases and a sign-in session.</li>
<li><strong>Payments.</strong> Stripe takes the payment and keeps your card details. We receive your Stripe customer ID and what you bought.</li>
<li><strong>Logs.</strong> Cloudflare keeps short-lived request logs, such as IP address, URL and errors, for security and abuse prevention.</li>
<li><strong>Analytics.</strong> Google Analytics counts page views. Each visit sends the page address without its query or anchor, the page title, and your browser, device type and approximate location. File names, file content and findings are never sent.</li>
</ul>
<p>We do not sell personal data and do not use advertising.</p>

<h2>Cookies and local storage</h2>
<p>Signing in sets a session cookie for 30 days and a cookie that tells the page you are signed in. Google sign-in sets a short-lived cookie that protects the login. Local storage keeps the free allowance ID and your settings, such as the theme and your analytics choice. These are needed for the site to work.</p>
<p>Google Analytics sets <code>_ga</code> cookies that last up to 2 years. In the EU, EEA, UK and Switzerland they are only set after you accept them in the bar at the bottom of the page; until then Google Analytics counts the visit without cookies. Elsewhere they are set unless you decline. You can change your choice at any time with the Cookies button at the bottom of every page, and declining deletes these cookies.</p>

<h2>Who processes data</h2>
<ul>
<li><strong>Cloudflare</strong> hosts the site, runs the AI models and sends sign-in emails.</li>
<li><strong>Stripe</strong> handles payments, subscriptions and refunds.</li>
<li><strong>Google</strong> confirms your identity if you sign in with Google, and runs Google Analytics with Google signals and ad personalisation turned off.</li>
<li><strong>jsDelivr</strong> serves the OCR engine and picture models to your browser.</li>
</ul>
<p>These providers may process data outside your country, under their own safeguards for international transfers.</p>

<h2>Purpose and legal basis</h2>
<p>We use this data to provide the service you ask for, to count free and paid use, to take payments and to prevent abuse. We use analytics to see which pages people use. The legal bases are the contract with you, our legitimate interest in keeping the service secure and fair, your consent for analytics cookies where the law asks for it, and our legal duties such as keeping tax records.</p>

<h2>How long we keep it</h2>
<p>File content is gone once the request ends. Daily counters are replaced the next day. Sign-in links expire after 15 minutes and sessions after 30 days. Account data stays until you ask us to delete it. Payment records are kept as long as tax law requires. Google Analytics keeps visit data for 2 months.</p>

<h2>Your rights</h2>
<p>You can ask for a copy of your data, a correction, or deletion of your account, and you can object to processing. Write to ${mail} from the email address on your account. You can also complain to your local data protection authority.</p>

<h2>Children</h2>
<p>AnyRedact is not meant for children under 16. If you think a child has given us personal data, write to us and we will delete it.</p>

<h2>Changes</h2>
<p>We will post changes to this policy here and update the date below. If a change affects how your files are handled, we will also email account holders.</p>`,
  },
  {
    slug: 'terms',
    nav: 'Terms',
    title: 'Terms of Service | AnyRedact',
    description: 'The terms for using AnyRedact: free daily credits, plans and packs, your responsibility to review every redacted file, and the limits of our liability.',
    h1: 'Terms of service',
    body: `
<p>These terms apply when you use anyredact.app. By using it, you agree to them.</p>

<h2>The service</h2>
<p>AnyRedact finds personal information in documents, images, spreadsheets, presentations and recordings with AI, and lets you remove it before you share the file. We may change, add or remove features at any time.</p>

<h2>Check every file</h2>
<p>Automatic detection misses things and marks things that are not sensitive. You decide what to redact, and you are responsible for reviewing the downloaded file before you share it. AnyRedact is not legal advice and does not make a file compliant with any law or regulation.</p>

<h2>Your content</h2>
<p>Your files stay yours. You give us permission to process the parts the editor sends, only to provide the service. You must have the right to process the files you open.</p>

<h2>Accounts</h2>
<p>You need an account only to buy credits. Keep access to your email or Google account secure, since it is how you sign in. You must be 18 or older to buy credits.</p>

<h2>Credits, plans and packs</h2>
<ul>
<li>Every browser gets free credits each day. Unused free credits do not carry over.</li>
<li>A plan renews each month until you cancel it under Manage plan on your account page. Its credits reset at each renewal and end with the plan.</li>
<li>Packs are paid once and their credits do not expire.</li>
<li>Free credits are used first, then the plan, then packs.</li>
<li>Credits have no cash value and cannot be transferred.</li>
<li>Prices are in US dollars and shown on the <a href="/pricing">pricing page</a>.</li>
</ul>
<p>Refunds are covered by our <a href="/refunds">refund policy</a>.</p>

<h2>Acceptable use</h2>
<p>Do not use AnyRedact to break the law or anyone's rights, to get around the free limits, to overload or attack the service, to resell it, or to send content meant to manipulate the AI. We may suspend or close an account that does, without a refund for credits used in breach of these terms.</p>

<h2>Our content</h2>
<p>The site, its code and its text belong to AnyRedact. All rights are reserved.</p>

<h2>No warranty</h2>
<p>The service is provided as is and as available. We do not promise that it will find all personal information, run without interruption, or suit a particular purpose.</p>

<h2>Liability</h2>
<p>To the extent the law allows, we are not liable for indirect or consequential losses, or for harm caused by information left in a file you shared. Our total liability is limited to what you paid us in the 12 months before the claim. Nothing in these terms limits rights you have as a consumer that cannot be limited by contract.</p>

<h2>Changes</h2>
<p>We may update these terms. The new version applies from the date below. If a change reduces your rights, we will email account holders first.</p>

<h2>Contact</h2>
<p>Questions about these terms go to ${mail}.</p>`,
  },
  {
    slug: 'refunds',
    nav: 'Refunds',
    title: 'Refund Policy | AnyRedact',
    description: 'Refunds for AnyRedact plans and credit packs: unused credits within 14 days, cancel a plan any time, and billing errors always refunded.',
    h1: 'Refund policy',
    body: `
<h2>Packs</h2>
<p>Within 14 days of buying a pack, you can ask for a refund of the credits you have not used. We refund their share of the price, and those credits leave your balance.</p>

<h2>Plans</h2>
<p>You can cancel a plan at any time under Manage plan on your account page. It stops renewing, and you keep its credits until the end of the month you paid for. Within 14 days of a plan payment, if you have used none of that month's credits, you can ask for the payment back. A refunded plan payment ends that month's credits.</p>

<h2>Billing errors</h2>
<p>A double charge, or a charge after you cancelled, is refunded in full.</p>

<h2>How to ask</h2>
<p>Email <a href="mailto:support@anyredact.app?subject=Refund">support@anyredact.app</a> from the address on your account and say which payment it is about. Refunds go back to the card you paid with through Stripe and usually arrive within 5 to 10 business days.</p>

<h2>Chargebacks</h2>
<p>If you dispute a payment with your bank, the credits it bought are removed while the dispute is open. Write to us first and we will try to sort it out.</p>`,
  },
  {
    slug: 'contact',
    nav: 'Contact',
    title: 'Contact | AnyRedact',
    description: 'Contact AnyRedact about support, refunds, privacy requests or security issues.',
    h1: 'Contact',
    dated: false,
    body: `
<p>Email ${mail} for support, billing, refunds, privacy requests and security reports.</p>
<p>For anything about your account, write from the email address you sign in with. Please do not attach the documents you were redacting.</p>`,
  },
];
