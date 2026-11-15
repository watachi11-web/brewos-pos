// Sheets must store phone numbers as identifiers, including every leading zero.
function brewCustomerPhoneCell_(phone) {
  return {
    userEnteredValue: {stringValue: String(phone == null ? '' : phone)},
    userEnteredFormat: {numberFormat: {type: 'TEXT'}}
  };
}

function brewAppendCustomer_(sheet, customer) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('phone') < 0) throw Error('CUSTOMERS_PHONE_COLUMN_MISSING');
  var values = headers.map(function(header) {
    if (header === 'phone') return brewCustomerPhoneCell_(customer.phone);
    var value = customer[String(header).trim()];
    return {userEnteredValue: typeof value === 'number'
      ? {numberValue: value} : {stringValue: String(value == null ? '' : value)}};
  });
  Sheets.Spreadsheets.batchUpdate({requests: [{appendCells: {
    sheetId: sheet.getSheetId(), rows: [{values: values}],
    fields: 'userEnteredValue,userEnteredFormat.numberFormat'
  }}]}, CONFIG.SPREADSHEET_ID);
}

function brewUpdateCustomerPhone_(sheet, row, column, phone) {
  Sheets.Spreadsheets.batchUpdate({requests: [{updateCells: {
    start: {sheetId: sheet.getSheetId(), rowIndex: row, columnIndex: column},
    rows: [{values: [brewCustomerPhoneCell_(phone)]}],
    fields: 'userEnteredValue,userEnteredFormat.numberFormat'
  }}]}, CONFIG.SPREADSHEET_ID);
}
