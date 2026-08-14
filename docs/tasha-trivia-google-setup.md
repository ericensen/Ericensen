# Tasha Trivia Google Apps Setup

This app works in local demo mode until a Google Apps Script web app URL is added to `app.js`.

## 1. Create the Sheet

1. Create a new Google Sheet named `Tasha Trivia Responses`.
2. Open `Extensions > Apps Script`.
3. Replace the starter code with the contents of `google-apps-script/tasha-trivia-backend.gs`.
4. Save the Apps Script project.

## 2. Add the host PIN

1. In Apps Script, open `Project Settings`.
2. Under `Script Properties`, add:
   - Property: `HOST_PIN`
   - Value: your host PIN

If no property is set, the fallback PIN is `tasha`.

## 3. Initialize the Sheet

1. In Apps Script, select the `setupTashaTrivia` function.
2. Click `Run`.
3. Approve the Google permissions.

This creates the `Responses` and `Config` tabs.

## 4. Deploy the web app

1. Click `Deploy > New deployment`.
2. Choose `Web app`.
3. Set `Execute as` to `Me`.
4. Set access to `Anyone`.
5. Click `Deploy`.
6. Copy the `/exec` web app URL.

## 5. Connect the homepage

In `app.js`, find:

```js
const scriptUrl = "";
```

Paste the Apps Script URL:

```js
const scriptUrl = "https://script.google.com/macros/s/.../exec";
```

Commit and push the change. The app will switch from `Demo mode` to `Shared mode`.

## 6. Customize questions

Questions are hardcoded in the `questions` array inside the `tashaTrivia` module in `app.js`.
Each question has:

- `id`: stable identifier
- `prompt`: question text
- `correct`: the correct option id
- `options`: multiple-choice answers
