const RESPONSE_SHEET_NAME = "Responses";
const CONFIG_SHEET_NAME = "Config";
const RESPONSE_HEADERS = ["submitted_at", "player_id", "player_name", "answers_json"];
const CONFIG_HEADERS = ["key", "value"];

function setupTashaTrivia() {
  ensureSheets_();
  if (!getConfigValue_("game_open")) {
    setConfigValue_("game_open", "TRUE");
  }
}

function doGet(e) {
  try {
    setupTashaTrivia();
    const action = String(e.parameter.action || "state").toLowerCase();
    let result;

    if (action === "state") {
      result = getState_();
    } else if (action === "submit") {
      result = submitResponse_(e.parameter);
    } else if (action === "responses") {
      requireHostPin_(e.parameter.pin);
      result = getState_();
      result.responses = getResponses_();
    } else if (action === "close") {
      requireHostPin_(e.parameter.pin);
      setConfigValue_("game_open", "FALSE");
      result = getState_();
      result.responses = getResponses_();
    } else if (action === "open") {
      requireHostPin_(e.parameter.pin);
      setConfigValue_("game_open", "TRUE");
      result = getState_();
      result.responses = getResponses_();
    } else if (action === "reset") {
      requireHostPin_(e.parameter.pin);
      resetResponses_();
      setConfigValue_("game_open", "TRUE");
      result = getState_();
      result.responses = getResponses_();
    } else {
      result = { ok: false, error: "Unknown action." };
    }

    return output_(e, result);
  } catch (error) {
    return output_(e, { ok: false, error: error.message || String(error) });
  }
}

function getState_() {
  return {
    ok: true,
    mode: "shared",
    open: getConfigValue_("game_open") !== "FALSE",
    responseCount: getResponses_().length
  };
}

function submitResponse_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    if (getConfigValue_("game_open") === "FALSE") {
      return { ok: false, error: "The game is closed." };
    }

    const payload = parseSubmitPayload_(params);
    if (!payload.playerId || !payload.playerName || !payload.answers) {
      return { ok: false, error: "Missing player name or answers." };
    }

    const sheet = responseSheet_();
    const values = sheet.getDataRange().getValues();
    const row = [
      new Date(),
      payload.playerId,
      payload.playerName,
      JSON.stringify(payload.answers)
    ];
    let existingRow = 0;
    for (let index = 1; index < values.length; index += 1) {
      if (String(values[index][1]) === String(payload.playerId)) {
        existingRow = index + 1;
        break;
      }
    }
    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, RESPONSE_HEADERS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return getState_();
  } finally {
    lock.releaseLock();
  }
}

function parseSubmitPayload_(params) {
  if (params.payload) {
    return JSON.parse(params.payload);
  }
  return {
    playerId: params.playerId || "",
    playerName: params.playerName || "",
    answers: params.answers ? JSON.parse(params.answers) : null
  };
}

function getResponses_() {
  const sheet = responseSheet_();
  const values = sheet.getDataRange().getValues();
  return values.slice(1)
    .filter((row) => row[1])
    .map((row) => ({
      submittedAt: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ""),
      playerId: String(row[1] || ""),
      playerName: String(row[2] || ""),
      answers: row[3] ? JSON.parse(row[3]) : {}
    }));
}

function resetResponses_() {
  const sheet = responseSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, RESPONSE_HEADERS.length).clearContent();
  }
}

function requireHostPin_(pin) {
  const expectedPin = PropertiesService.getScriptProperties().getProperty("HOST_PIN") || "tasha";
  if (String(pin || "") !== expectedPin) {
    throw new Error("Host PIN did not match.");
  }
}

function ensureSheets_() {
  ensureSheet_(RESPONSE_SHEET_NAME, RESPONSE_HEADERS);
  ensureSheet_(CONFIG_SHEET_NAME, CONFIG_HEADERS);
}

function ensureSheet_(name, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeaders = headers.some((header, index) => currentHeaders[index] !== header);
  if (needsHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function responseSheet_() {
  return ensureSheet_(RESPONSE_SHEET_NAME, RESPONSE_HEADERS);
}

function configSheet_() {
  return ensureSheet_(CONFIG_SHEET_NAME, CONFIG_HEADERS);
}

function getConfigValue_(key) {
  const sheet = configSheet_();
  const values = sheet.getDataRange().getValues();
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][0]) === key) {
      return String(values[index][1] || "");
    }
  }
  return "";
}

function setConfigValue_(key, value) {
  const sheet = configSheet_();
  const values = sheet.getDataRange().getValues();
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][0]) === key) {
      sheet.getRange(index + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function output_(e, payload) {
  const callback = e.parameter.callback;
  const body = callback
    ? `${callback}(${JSON.stringify(payload)});`
    : JSON.stringify(payload);
  const mimeType = callback
    ? ContentService.MimeType.JAVASCRIPT
    : ContentService.MimeType.JSON;
  return ContentService.createTextOutput(body).setMimeType(mimeType);
}
