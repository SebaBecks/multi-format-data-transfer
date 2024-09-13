
const stringify = require("csv-stringify");
const { JSDOM } = require("jsdom"); // For HTML conversion
const json2xml = require("json2xml"); // For XML conversion
const ExcelJS = require('exceljs'); // For XLSX conversion 

const json_response = async (table, str, format, table_style, table_position, table_header, table_total, header_filter, custom_alignment, aligment_vertical, aligment_horizontal, as_table) => {
  let blob;
  let filename;
  let mimetype;

  switch (format) {
    //csv
    case "csv":
      blob = Buffer.from(str).toString("base64");
      filename = `${table.name}.csv`;
      mimetype = "text/csv";
      break;

    //xlsx
    case "xlsx":
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(table.name);
      const data = JSON.parse(str);

      if (as_table === true) {
        worksheet.addTable({
          name: table.name,
          ref: table_position,
          headerRow: table_header,
          totalsRow: table_total,
          style: {
            theme: table_style,
            showRowStripes: true,
          },
  
          columns: Object.keys(data[0]).map((key) => ({name: key, filterButton: header_filter})),
          rows: data.map((row) => Object.values(row)),
  
        });
      }
      else {
        worksheet.columns = Object.keys(data[0]).map((key) => ({header: key, key}));
        worksheet.addRows(data);
      }
      //Align custom cells
      if (custom_alignment === true) {
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            cell.alignment = { vertical: aligment_vertical, horizontal: aligment_horizontal };
          });
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();

      blob = buffer.toString("base64");
      filename = `${table.name}.xlsx`;
      mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      break;

    //html  
    case "html":
      const dom = new JSDOM(`<!DOCTYPE html><html><body><pre>${str}</pre></body></html>`);
      blob = Buffer.from(dom.serialize()).toString("base64");
      filename = `${table.name}.html`;
      mimetype = "text/html";
      break;

    //ods
    case "OpenDocument":
      // Implement OpenDocument format logic here
      // Set blob, filename, and mimetype accordingly
      break;

    //xml
    case "xml":
      const xml = json2xml(JSON.parse(str));
      console.log(xml);
      blob = Buffer.from(xml).toString("base64");
      filename = `${table.name}.xml`;
      mimetype = "application/xml";
      break;

    default:
      throw new Error("Unsupported format");
  }

  return {
    json: {
      download: {
        blob,
        filename,
        mimetype,
      },
    },
  };
};


const auto_expand_json_cols = (columns, table, rows) => {
  for (const field of table.fields) {
    if (field.type?.name === "JSON" && field.attributes?.hasSchema) {
      (field.attributes?.schema || []).forEach((s) => {
        columns.push(`${field.name}.${s.key}`);
      });
      columns.splice(columns.indexOf(field.name), 1);
      for (const row of rows) {
        Object.keys(row[field.name] || {}).forEach((k) => {
          row[`${field.name}.${k}`] = row[field.name][k];
        });
        delete row[field.name];
      }
    }
  }
};
const async_stringify = (...args) => {
  return new Promise((resolve) => {
    stringify(...args, function (err, output) {
      resolve(output);
    });
  });
};
module.exports = { json_response, auto_expand_json_cols, async_stringify };
