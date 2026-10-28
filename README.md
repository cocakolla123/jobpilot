# JobPilot

JobPilot searches LinkedIn, Handshake and Indeed for you, saves the jobs it finds, picks the right resume for each one, and applies:

* **LinkedIn** with Easy Apply
* **Handshake** with Quick Apply
* **Indeed** with Indeed Apply
* **Company forms** on Lever, Ashby and Greenhouse

You run everything from a small dashboard on your own computer, and every application goes into a spreadsheet.

Resume matching is plain code with no AI. Your form answers (name, visa status, demographics and so on) come from a profile you fill in once. AI is optional and only writes open-ended answers like "Why do you want to work here?"

---

## What you need

* **Node.js 20 or newer**: [nodejs.org](https://nodejs.org)
* **Google Chrome**
* **Claude Code** (optional, for AI answers): [claude.com/claude-code](https://claude.com/claude-code). It uses your Claude plan, so no API key is needed.

## Install and start

```bash
cd jobpilot
npm install
npm start
```

The dashboard opens at http://127.0.0.1:4123. Leave the terminal window open while you use it. Press Ctrl+C to quit.

Your data lives in a workspace folder, `~/JobPilot` by default. To use a different folder:

```bash
npm start -- --workspace ~/Documents/MyJobSearch
```

---

## First time setup

Do these once, in this order. The dashboard's Setup tab walks you through the same steps.

### 1. Sign in to each site in JobPilot's Chrome

Click **Open Chrome** in the dashboard (or run `npm run chrome`). JobPilot opens its own Chrome window with its own profile, separate from your normal Chrome. Sign in to LinkedIn, Handshake and Indeed there once. It remembers you after that.

JobPilot never creates accounts, never types your passwords, and never solves captchas. If a site shows a login page or a security check, that site stops and the dashboard tells you. Finish the check in that window yourself, then run again.

### 2. Add your resumes

Put your resumes (PDF or Word) in the **resumes** folder of your workspace, or upload them on the Resumes tab. Name each one for the kind of job it fits, because the name is part of how it gets picked:

| File name | Used for |
| --- | --- |
| `Jane_Doe_Resume_Frontend.pdf` | frontend, UI, React roles |
| `Jane_Doe_Resume_Backend.pdf` | backend, platform, infrastructure |
| `Jane_Doe_Resume_ML.pdf` | machine learning, data science |
| `Jane_Doe_Resume_FDE.pdf` | forward deployed, solutions engineer |
| `Jane_Doe_Resume_SWE.pdf` | everything else (your general resume) |

You can also set tags, keywords and a default resume on the Resumes tab.

### 3. Upload your resumes to each site

Click **Upload resumes to sites**. JobPilot uploads each resume under its file name plus the date and time, like `Jane_Doe_Resume_SWE_2026-10-28_0915.pdf`, so you can always tell which copy is newest:

* **LinkedIn**: into the Resumes and application data section of your job application settings.
* **Handshake**: into Documents, filed as a Resume and kept hidden from employers. If you added a transcript under Documents on the Profile tab, it goes up too, filed as a Transcript.
* **Indeed**: Indeed keeps only one resume, so JobPilot puts your default resume there now. Before each Indeed application, it uses Replace file to swap in the resume that matches that job.

JobPilot remembers the exact name it uploaded for each resume on each site, and that copy is the one it picks when it applies. Older copies already on the site are never used and never deleted. Remove them yourself whenever you like.

If you edit a resume later, the next upload sends a newly dated copy. Apply also does this on its own before it starts, so the newest copy is always the one used. You can turn that off in Settings.

Then click **Check accounts**. It confirms you are signed in on each site, and shows each resume as current, outdated or missing there. It also shows your newest transcript on Handshake.

### 4. Fill in your profile

The Profile tab asks what most application forms ask:
* name, contact details and links
* school, degree, GPA and graduation date
* work authorization, sponsorship and visa status
* start date, relocation and salary
* the voluntary questions (gender, race, veteran and disability status), which default to "Decline to self identify" unless you choose otherwise

Add your transcript and an optional cover letter under Documents.

### 5. Add your skills

Click **Scan my resumes** to pull skills like Python, React or AWS out of your resumes, then set your years for each one. JobPilot uses these to answer questions like "How many years of experience do you have with React?" A skill you don't list is answered as 0 years, or No.

### 6. Add a search

On the Searches tab, set keywords, location, level (internship, entry), how recent and which sites. You can also paste a search URL from a site to use that exact search.

---

## Daily use

1. **Search** finds jobs, skips senior roles and companies you excluded, presses each site's own Save button, and picks a resume for each job. Saved jobs show up on the Jobs tab with the chosen resume and why it was chosen.
2. **Apply** works through your saved jobs, best match first.
3. **Questions** lists anything a form asked that your profile could not answer. Answer it once, and JobPilot remembers it for every later form.

### How Apply handles tabs

* It goes one job at a time, each in its own background tab.
* When a site confirms the application, that tab closes.
* If anything is unsure, the tab stays open with the form filled in so you can finish it yourself. Unsure means a question it can't answer, an AI answer you should read, submit being turned off, an error, or no confirmation from the site.
* Once 8 tabs are waiting (you can change this), the run pauses and asks you to finish them first. Closing a tab frees its slot.
* After you submit one yourself, click **I submitted it** on the Jobs tab so it goes into your sheet.

### Submit is off at first

Until you turn **Submit applications** on in Settings, JobPilot fills every form and stops at the Submit button, leaving it open for you. Run a few that way and check its work before you turn it on.

---

## AI answers (optional)

Some forms ask open-ended questions like "Why do you want to work here?" or "Tell us about a project". With AI answers on:

* JobPilot asks Claude to write a short answer from your resume, your profile and that job posting. It uses only facts in your resume. If the question can't be answered honestly from your resume, the question goes to your Questions tab instead.
* By default the answer is filled in and **the tab is left open for you to read and submit**. Turn on **Submit AI answers without review** in Settings if you would rather it submit on its own.
* Yes/no questions, numbers, dates, dropdowns, your profile and resume matching never use AI.

**Using your Claude Code sign-in (default).** Install Claude Code and run `claude` once to sign in. JobPilot runs it in the background (`claude -p`), so answers come out of your Claude plan's usage with no API key and no separate bill. It runs with every tool turned off, no plugins or connectors, and from an empty folder, so text inside a job posting can't make it act on your computer. Each answer takes about 5 seconds.

**Using an API key instead.** Pick "Anthropic API key" in Settings and paste your key. It is saved only in your workspace (`.secrets.json`, readable only by you) and is never shown back in full. This is billed per answer, about 2 to 3 cents each with Opus.

Click **Try it** in Settings to see a sample answer before you turn it on.

---

## How resume matching works

There's no AI here. Every pick can be explained.

1. **Role fit.** The job title is mapped to role tags (frontend, backend, ml, fde, quant and so on) using a fixed word list. Each resume gets tags from its file name or from what you set.
2. **Content fit.** The posting text is compared with each resume's text using TF-IDF similarity. Words every resume shares count little, so the words that set your resumes apart count most.
3. **Score.** 55% role fit plus 45% content fit. Ties go to your default resume.

A plain title like "Software Engineer" says nothing about the kind of work, so for those the posting's text decides. A React heavy posting gets your frontend resume, and an ordinary one still gets your default.

The Jobs tab shows the score, the matching tags and the shared terms for each pick. You can change the resume on any job before applying. Paste any posting into **Test a match** on the Resumes tab to see how all your resumes rank for it.

---

## Your workspace folder

```
~/JobPilot/
  applications.csv      every application (open it in Excel or Google Sheets)
  resumes/              your resumes; the folder JobPilot matches from
  resumes/resumes.json  optional tags, keywords and default resume
  documents/            transcript and cover letter
  profile.json          your answers for common questions
  answers.json          answers you added for other questions
  searches.json         your searches
  settings.json         settings
  jobs.json             saved jobs and their status
  resume-sync.json      the dated name of each resume on each site
  logs/                 one log file per day
  .chrome-profile/      JobPilot's Chrome sign-ins
```

To copy your setup to another computer, copy this folder. Leave out `.chrome-profile/` and sign in again there.

## Command line

The dashboard is the easy way. These do the same jobs from a terminal:

```bash
node bin/jobpilot.mjs              # start the dashboard
node bin/jobpilot.mjs chrome       # open JobPilot's Chrome to sign in
node bin/jobpilot.mjs check        # check sign-ins and which resumes are current on each site
node bin/jobpilot.mjs sync         # upload new or edited resumes to each site
node bin/jobpilot.mjs search       # run your saved searches
node bin/jobpilot.mjs apply --limit 10
```

Add `--workspace <folder>` to any of them.

## Limits and good sense

* **Daily caps.** By default, at most 25 LinkedIn, 30 Handshake, 10 Indeed and 30 company form applications a day, counted from your sheet. LinkedIn limits Easy Apply accounts that go much past this. There's also a pause of 6 to 12 seconds between jobs.
* **Site rules.** LinkedIn, Indeed and Handshake don't allow automated use in their terms. Accounts that apply at high volume can be limited or suspended. Keep the caps low, read what you send, and use this at your own risk.
* **Security checks.** JobPilot stops instead of working around any captcha, login wall or security page.
* **Privacy.** Everything stays on your computer. The dashboard only answers on 127.0.0.1 and refuses requests from other websites. The only data that leaves your computer is what you send to job sites and, if AI answers are on, the question, posting and resume text sent to Claude.

## Tests

```bash
npm test
```

The tests run the form filler and the LinkedIn Easy Apply flow against local practice pages in your installed Chrome, with no window. They never touch a real job site, and they never call Claude.

## License

MIT. Use it, change it and share it. See [LICENSE](LICENSE).
