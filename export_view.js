/**
* Plugin developed on base of the plugin "saltcorn/csv-io"
* by "saltcorn/saltcorn"
* 
* @see <a href="https://github.com/saltcorn/csv-io" target="_blank">https://github.com/saltcorn/csv-io</a>
**/

const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const Library = require("@saltcorn/data/models/library");
const User = require("@saltcorn/data/models/user");
const View = require("@saltcorn/data/models/view");
const Workflow = require("@saltcorn/data/models/workflow");
const FieldRepeat = require("@saltcorn/data/models/fieldrepeat");
const fs = require("fs");

const URL = require("url").URL;
const {
  text,
  div,
  h5,
  h6,
  style,
  a,
  script,
  pre,
  domReady,
  i,
  hr,
  text_attr,
  button,
} = require("@saltcorn/markup/tags");
const {
  field_picker_fields,
  picked_fields_to_query,
  stateFieldsToWhere,
  stateFieldsToQuery,
  readState,
  initial_config_all_fields,
  calcfldViewOptions,
  calcrelViewOptions,
} = require("@saltcorn/data/plugin-helper");

const {
  get_viewable_fields,
  get_viewable_fields_from_layout,
} = require("@saltcorn/data/base-plugin/viewtemplates/viewable_fields");
const { hashState } = require("@saltcorn/data/utils");
const { getState, features } = require("@saltcorn/data/db/state");

const {
  json_response,
  auto_expand_json_cols,
  async_stringify,
} = require("./common");
const { type } = require("os");

const initial_config = async ({ table_id, exttable_name }) => {
  return { columns: [], layout: { list_columns: true, besides: [] } };
};

const columnsListBuilderStep = {
  name: "Columns",
  onlyWhen: (context) => context.what !== "All columns",
  builder: async (context) => {
    const table = await Table.findOne(
      context.table_id
        ? { id: context.table_id }
        : { name: context.exttable_name }
    );
    const fields = table.getFields();
    const { field_view_options, handlesTextStyle } = calcfldViewOptions(
      fields,
      "list"
    );
    if (table.name === "users") {
      fields.push(
        new Field({
          name: "verification_url",
          label: "Verification URL",
          type: "String",
        })
      );
      field_view_options.verification_url = ["as_text", "as_link"];
    }
    const rel_field_view_options = await calcrelViewOptions(table, "list");
    const roles = await User.get_roles();
    const { parent_field_list } = await table.get_parent_relations(true, true);

    const { child_field_list, child_relations } =
      await table.get_child_relations(true);
    var agg_field_opts = {};
    child_relations.forEach(({ table, key_field, through }) => {
      const aggKey =
        (through ? `${through.name}->` : "") +
        `${table.name}.${key_field.name}`;
      agg_field_opts[aggKey] = table.fields
        .filter((f) => !f.calculated || f.stored)
        .map((f) => ({
          name: f.name,
          label: f.label,
          ftype: f.type.name || f.type,
          table_name: table.name,
          table_id: table.id,
        }));
    });
    const agg_fieldview_options = {};

    Object.values(getState().types).forEach((t) => {
      agg_fieldview_options[t.name] = Object.entries(t.fieldviews)
        .filter(([k, v]) => !v.isEdit && !v.isFilter)
        .map(([k, v]) => k);
    });
    const library = (await Library.find({})).filter((l) =>
      l.suitableFor("list")
    );

    if (!context.layout?.list_columns) {
      // legacy views
      const newCols = [];

      const typeMap = {
        Field: "field",
        JoinField: "join_field",
        ViewLink: "view_link",
        Link: "link",
        Action: "action",
        Text: "blank",
        DropdownMenu: "dropdown_menu",
        Aggregation: "aggregation",
      };
      (context.columns || []).forEach((col) => {
        const newCol = {
          alignment: col.alignment || "Default",
          col_width: col.col_width || "",
          showif: col.showif || "",
          header_label: col.header_label || "",
          col_width_units: col.col_width_units || "px",
          contents: {
            ...col,
            configuration: { ...col },
            type: typeMap[col.type],
          },
        };
        delete newCol.contents._columndef;
        delete newCol.contents.configuration._columndef;
        delete newCol.contents.configuration.type;

        switch (col.type) {
          case "ViewLink":
            newCol.contents.isFormula = {
              label: !!col.view_label_formula,
            };
            break;
          case "Link":
            newCol.contents.isFormula = {
              url: !!col.link_url_formula,
              text: !!col.link_text_formula,
            };
            newCol.contents.text = col.link_text;
            newCol.contents.url = col.link_url;
            break;
        }

        newCols.push(newCol);
      });

      context.layout = {
        besides: newCols,
        list_columns: true,
      };
    }
    return {
      tableName: table.name,
      fields: fields.map((f) => f.toBuilder),

      //fieldViewConfigForms,
      field_view_options: {
        ...field_view_options,
        ...rel_field_view_options,
      },
      parent_field_list,
      child_field_list,
      agg_field_opts,
      agg_fieldview_options,
      actions: [],
      triggerActions: [],
      builtInActions: [],
      roles,
      disable_toolbox: { action: true, view: true, dropdown_menu: true },
      library,

      handlesTextStyle,
      mode: "list",
      ownership:
        !!table.ownership_field_id ||
        !!table.ownership_formula ||
        table.name === "users",
    };
  },
};

const columnsLegacyStep = (req) => ({
  name: "Columns",
  onlyWhen: (context) => context.what !== "All columns",
  form: async (context) => {
    const table = await Table.findOne(
      context.table_id
        ? { id: context.table_id }
        : { name: context.exttable_name }
    );
    const field_picker_repeat = await field_picker_fields({
      table,
      viewname: context.viewname,
      req,
    });

    const type_pick = field_picker_repeat.find((f) => f.name === "type");
    type_pick.attributes.options = type_pick.attributes.options.filter(
      ({ name }) =>
        ["Field", "JoinField", "Aggregation", "FormulaValue"].includes(name)
    );

    const use_field_picker_repeat = field_picker_repeat.filter(
      (f) => !["state_field", "col_width", "col_width_units"].includes(f.name)
    );

    return new Form({
      fields: [
        {
          name: "what",
          type: "String",
          required: true,
          attributes: { options: ["Whole table", "Specify columns"] },
        },
        new FieldRepeat({
          name: "columns",
          fancyMenuEditor: true,
          showIf: { what: "Whole table" },
          fields: use_field_picker_repeat,
        }),
      ],
    });
  },
});

const configuration_workflow = (req) =>
  new Workflow({
    steps: [
      {
        name: "Specification",
        form: () =>
          new Form({
            fields: [
              {
                name: "what",
                label: "What to export",
                type: "String",
                required: true,
                attributes: { options: ["All columns", "Specify columns"] },
                sublabel:
                  "Select 'Selected columns' to export only selected columns",
              },
              {
                name: "export_format",
                label: "Export to ",
                type: "String",
                required: true,
                attributes: {
                  options: [
                    { name: "xlsx", label: "Export to Excel (.xlsx)" },
                    { name: "csv", label: "Export to CSV (.csv)" },
                    { name: "html", label: "Export to HTML (.html)" },
                    {
                      name: "OpenDocument",
                      label: "Export to OpenDocument (.ods)",
                    },
                    { name: "xml", label: "Export to XML (.xml)" },
                  ],
                },
                default: "xlsx",
                sublabel: "Select the format to export",
              },
              {
                name: "label",
                label: "Label",
                type: "String",
                required: true,
                default: "Download file",
                sublabel: "The label of the button",
              },
              //csv configuration
              {
                name: "delimiter",
                label: "Delimiter",
                type: "String",
                required: true,
                attributes: {
                  options: [
                    { name: ",", label: "Comma (,)" },
                    { name: ";", label: "Semicolon (;)" },
                    { name: "\t", label: "Tab (⇥)" },
                  ],
                },
                sublabel: "The delimiter to use in csv files",
                showIf: { export_format: "csv" },
              },
              {
                name: "bom",
                label: "Add BOM",
                sublabel: "Prepend the UTF-8 byte order mark (BOM) to the file",
                type: "Bool",
                showIf: { export_format: "csv" },
              },
              //html configuration
              {
                name: "background_header_color",
                label: "Background Header",
                type: "String",
                required: true,
                attributes: {
                  input_type: "color",
                  placeholder: "#ffffff",
                },
                default: "#2C3E50",
                sublabel: "Choose a color for the background Header",
                showIf: { export_format: "html" },
              },
              {
                name: "font_header_color",
                label: "Font Header",
                type: "String",
                required: true,
                attributes: {
                  input_type: "color",
                  placeholder: "#ffffff",
                },
                default: "#ffffff",
                sublabel: "Choose a color for the Font Header",
                showIf: { export_format: "html" },
              },
              //xlsx configuration
              {
                name: "as_table",
                label: "As table",
                sublabel: "Export the data as a table in a spreadsheet",
                type: "Bool",
                required: true,
                default: true,
                showIf: { export_format: "xlsx" },
              },
              {
                name: "table_position",
                label: "Table position",
                sublabel:
                  "Choose a position for the table in the spreadsheet - (e.g. A1)",
                type: "String",
                required: true,
                default: "A1",
                showIf: { export_format: "xlsx", as_table: true },
              },
              {
                name: "table_style",
                label: "Table theme style",
                sublabel:
                  "Choose a theme style for the table - Light 1-21, Medium 1-28, Dark 1-11",
                type: "String",
                required: true,
                default: "TableStyleMedium2",
                attributes: {
                  options: [
                    { name: "TableStyleLight1", label: "Light 1" },
                    { name: "TableStyleLight2", label: "Light 2" },
                    { name: "TableStyleLight3", label: "Light 3" },
                    { name: "TableStyleLight4", label: "Light 4" },
                    { name: "TableStyleLight5", label: "Light 5" },
                    { name: "TableStyleLight6", label: "Light 6" },
                    { name: "TableStyleLight7", label: "Light 7" },
                    { name: "TableStyleLight8", label: "Light 8" },
                    { name: "TableStyleLight9", label: "Light 9" },
                    { name: "TableStyleLight10", label: "Light 10" },
                    { name: "TableStyleLight11", label: "Light 11" },
                    { name: "TableStyleLight12", label: "Light 12" },
                    { name: "TableStyleLight13", label: "Light 13" },
                    { name: "TableStyleLight14", label: "Light 14" },
                    { name: "TableStyleLight15", label: "Light 15" },
                    { name: "TableStyleLight16", label: "Light 16" },
                    { name: "TableStyleLight17", label: "Light 17" },
                    { name: "TableStyleLight18", label: "Light 18" },
                    { name: "TableStyleLight19", label: "Light 19" },
                    { name: "TableStyleLight20", label: "Light 20" },
                    { name: "TableStyleLight21", label: "Light 21" },
                    { name: "TableStyleMedium1", label: "Medium 1" },
                    { name: "TableStyleMedium2", label: "Medium 2" },
                    { name: "TableStyleMedium3", label: "Medium 3" },
                    { name: "TableStyleMedium4", label: "Medium 4" },
                    { name: "TableStyleMedium5", label: "Medium 5" },
                    { name: "TableStyleMedium6", label: "Medium 6" },
                    { name: "TableStyleMedium7", label: "Medium 7" },
                    { name: "TableStyleMedium8", label: "Medium 8" },
                    { name: "TableStyleMedium9", label: "Medium 9" },
                    { name: "TableStyleMedium10", label: "Medium 10" },
                    { name: "TableStyleMedium11", label: "Medium 11" },
                    { name: "TableStyleMedium12", label: "Medium 12" },
                    { name: "TableStyleMedium13", label: "Medium 13" },
                    { name: "TableStyleMedium14", label: "Medium 14" },
                    { name: "TableStyleMedium15", label: "Medium 15" },
                    { name: "TableStyleMedium16", label: "Medium 16" },
                    { name: "TableStyleMedium17", label: "Medium 17" },
                    { name: "TableStyleMedium18", label: "Medium 18" },
                    { name: "TableStyleMedium19", label: "Medium 19" },
                    { name: "TableStyleMedium20", label: "Medium 20" },
                    { name: "TableStyleMedium21", label: "Medium 21" },
                    { name: "TableStyleMedium22", label: "Medium 22" },
                    { name: "TableStyleMedium23", label: "Medium 23" },
                    { name: "TableStyleMedium24", label: "Medium 24" },
                    { name: "TableStyleMedium25", label: "Medium 25" },
                    { name: "TableStyleMedium26", label: "Medium 26" },
                    { name: "TableStyleMedium27", label: "Medium 27" },
                    { name: "TableStyleMedium28", label: "Medium 28" },
                    { name: "TableStyleDark1", label: "Dark 1" },
                    { name: "TableStyleDark2", label: "Dark 2" },
                    { name: "TableStyleDark3", label: "Dark 3" },
                    { name: "TableStyleDark4", label: "Dark 4" },
                    { name: "TableStyleDark5", label: "Dark 5" },
                    { name: "TableStyleDark6", label: "Dark 6" },
                    { name: "TableStyleDark7", label: "Dark 7" },
                    { name: "TableStyleDark8", label: "Dar 8" },
                    { name: "TableStyleDark9", label: "Dark 9" },
                    { name: "TableStyleDark10", label: "Dark 10" },
                    { name: "TableStyleDark11", label: "Dark 11" },
                  ],
                },
                showIf: { export_format: "xlsx", as_table: true },
              },
              {
                name: "table_header",
                label: "Table header",
                sublabel: "Show table header",
                type: "Bool",
                default: true,
                showIf: { export_format: "xlsx", as_table: true },
              },
              {
                name: "header_filter",
                label: "Header filter",
                sublabel: "Show header filter",
                type: "Bool",
                default: false,
                showIf: { export_format: "xlsx", as_table: true },
              },
              {
                name: "table_total",
                label: "Table total",
                sublabel: "Show table total row",
                type: "Bool",
                default: true,
                showIf: { export_format: "xlsx", as_table: true },
              },
              {
                name: "custom_alignment",
                label: "Custom alignment",
                sublabel: "Show custom alignment",
                type: "Bool",
                default: false,
                showIf: { export_format: "xlsx" },
              },
              {
                name: "aligment_vertical",
                label: "Aligment vertical",
                sublabel: "Cell aligment vertical",
                type: "String",
                default: "middle",
                attributes: {
                  options: [
                    { name: "top", label: "Top" },
                    { name: "middle", label: "Middle" },
                    { name: "bottom", label: "Bottom" },
                  ],
                },
                required: true,
                showIf: { export_format: "xlsx", custom_alignment: true },
              },
              {
                name: "aligment_horizontal",
                label: "Aligment horizontal",
                sublabel: "Cell aligment horizontal",
                type: "String",
                default: "Left",
                attributes: {
                  options: [
                    { name: "left", label: "Left" },
                    { name: "center", label: "Center" },
                    { name: "right", label: "Right" },
                  ],
                },
                required: true,
                showIf: { export_format: "xlsx", custom_alignment: true },
              },
            ],
          }),
      },
      features.list_builder ? columnsListBuilderStep : columnsLegacyStep(req),
    ],
  });

const get_state_fields = async (table_id, viewname, { show_view }) => {
  const table_fields = await Field.find({ table_id }, { cached: true });
  return table_fields
    .filter((f) => !f.primary_key)
    .map((f) => {
      const sf = new Field(f);
      sf.required = false;
      return sf;
    });
};

const run = async (
  table_id,
  viewname,
  { columns, label },
  state,
  extraArgs
) => {
  return button(
    {
      class: "btn btn-primary",
      onclick: `view_post('${viewname}', 'do_download', {});`,
    },
    i({ class: "fas fa-download me-1" }),
    label || "Download file"
  );
};

const do_download = async (
  table_id,
  viewname,
  {
    columns,
    layout,
    what,
    delimiter,
    bom,
    export_format,
    as_table,
    table_style,
    table_position,
    table_header,
    header_filter,
    table_total,
    custom_alignment,
    aligment_vertical,
    aligment_horizontal,
    header_Color,
    font_color,
  },
  body,
  { req, res }
) => {
  const table = await Table.findOne(table_id);
  const state = {};
  const referrer = req.get("Referrer");
  if (referrer) {
    const refUrl = new URL(referrer || "");
    for (const [name, value] of refUrl.searchParams) {
      state[name] = value;
    }
  }
  const stateHash = hashState(state, viewname);

  const fields = await table.getFields();
  const { joinFields, aggregations } = picked_fields_to_query(columns, fields);
  const where = await stateFieldsToWhere({ fields, state, table });
  const q = await stateFieldsToQuery({
    state,
    fields,
    prefix: "a.",
    stateHash,
  });

  switch (export_format) {
    case "xlsx":
      if (what === "All columns") {
        const columns = table.fields
          .sort((a, b) => a.id - b.id)
          .map((f) => f.name);
        const rows = await table.getJoinedRows(
          where,
          { orderBy: "id" },
          joinFields,
          aggregations
        );

        auto_expand_json_cols(columns, table, rows);
        const data = rows.map((row) => {
          const rowData = {};
          columns.forEach((col) => {
            rowData[col] = row[col] || "";
          });
          return rowData;
        });

        const jsonData = JSON.stringify(data);
        return json_response(
          table,
          jsonData,
          export_format,
          table_style,
          table_position,
          table_header,
          table_total,
          header_filter,
          custom_alignment,
          aligment_vertical,
          aligment_horizontal,
          as_table
        );
      }
      let rowsdata = await table.getJoinedRows({
        where,
        orderBy: "id",
        joinFields,
        aggregations,
        ...q,
        forPublic: !req.user,
        forUser: req.user,
      });
      
      const tfields = layout?.list_columns
      ? get_viewable_fields_from_layout(
          viewname,
          stateHash,
          table,
          fields,
          columns,
          false,
          { noHTML: true, ...req },
          req.__,
          state,
          viewname,
          layout.besides
        )
      : get_viewable_fields(
          viewname,
          stateHash,
          table,
          fields,
          columns,
          false,
          { noHTML: true, ...req },
          req.__
        );
  
      const layoutCols = layout?.besides;

      const custRowsData = rowsdata.map((row) => {
        const rowData = {};
        tfields.forEach(({ label, key }, ix) => {
          const layooutCol = layoutCols?.[ix];
          rowData[layooutCol?.header_label || label] =
            typeof key === "function" ? key(row) : row[key];
        });
        return rowData;
      });

      const jsonData = JSON.stringify(custRowsData);
      return json_response(
        table,
        jsonData,
        export_format,
        table_style,
        table_position,
        table_header,
        table_total,
        header_filter,
        custom_alignment,
        aligment_vertical,
        aligment_horizontal,
        as_table
      );

    case "csv":
      if (what === "All columns") {
        const columns = table.fields
          .sort((a, b) => a.id - b.id)
          .map((f) => f.name);
        const rows = await table.getRows(where, { orderBy: "id" });
        auto_expand_json_cols(columns, table, rows);
        const str = await async_stringify(rows, {
          header: true,
          columns,
          bom: !!bom,
          delimiter: delimiter || ",",
          cast: {
            date: (value) => value.toISOString(),
            boolean: (v) => (v ? "true" : "false"),
          },
        });

        return json_response(table, str, export_format);
      } else {
        let rows = await table.getJoinedRows({
          where,
          joinFields,
          aggregations,
          ...q,
          forPublic: !req.user,
          forUser: req.user,
        });

        const tfields = layout?.list_columns
          ? get_viewable_fields_from_layout(
              viewname,
              stateHash,
              table,
              fields,
              columns,
              false,
              { noHTML: true, ...req },
              req.__,
              state,
              viewname,
              layout.besides
            )
          : get_viewable_fields(
              viewname,
              stateHash,
              table,
              fields,
              columns,
              false,
              { noHTML: true, ...req },
              req.__
            );

        const layoutCols = layout?.besides;
        const csvRows = rows.map((row) => {
          const csvRow = {};
          tfields.forEach(({ label, key }, ix) => {
            const layooutCol = layoutCols?.[ix];
            csvRow[layooutCol?.header_label || label] =
              typeof key === "function" ? key(row) : row[key];
          });
          return csvRow;
        });
        const str = await async_stringify(csvRows, {
          header: true,
          delimiter: delimiter || ",",
          bom: !!bom,
        });

        return json_response(table, str, export_format);
      }
    case "html":
      // Add code to handle html export
      if (what === "All columns") {
        const columns = table.fields
          .sort((a, b) => a.id - b.id)
          .map((f) => f.name);
        const rows = await table.getRows(where, { orderBy: "id" });
        auto_expand_json_cols(columns, table, rows);

        const data = rows.map((row) => {
          const rowData = {};
          columns.forEach((col) => {
            rowData[col] = row[col] || "";
          });
          return rowData;
        });

        const htmlString = `
          <style>
            table, th, td {border: 1px solid black; border-collapse: collapse;}
            tr:nth-child(even) {background-color: rgba(150, 212, 212, 0.4);}
            th:nth-child(even),td:nth-child(even) {background-color: rgba(150, 212, 212, 0.4);}
          </style>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid #dddddd; margin-left: auto; margin-right: auto;">
            <thead>
              <tr style="text-align: center; background-color: #dddddd;">${columns
                .map((col) => `<th>${col}</th>`)
                .join("")}</tr>
            </thead>
            <tbody>
              ${data
                .map(
                  (row) =>
                    `<tr style="text-align: center; border: 1px solid #dddddd;">${columns
                      .map(
                        (col) =>
                          `<td style="text-align: center; border-color: #dddddd">${row[col]}</td>`
                      )
                      .join("")}</tr>`
                )
                .join("")}
            </tbody>
          </table>
        `;
        //console.log(htmlString);
        return json_response(table, htmlString, export_format);
      }

    case "OpenDocument":
      // Add code to handle OpenDocument export

      break;
    case "xml":
      // Add code to handle xml export
      if (what === "All columns") {
        const columns = table.fields
          .sort((a, b) => a.id - b.id)
          .map((f) => f.name);
        const rows = await table.getRows(where, { orderBy: "id" });
        auto_expand_json_cols(columns, table, rows);
        const data = rows.map((row) => {
          const rowData = {};
          columns.forEach((col) => {
            rowData[col] = row[col] || "";
          });
          return rowData;
        });
        const xmlString = `
            <table>
              ${data
                .map(
                  (row) => `
                <row>
                  ${columns
                    .map((col) => `<${col}>${row[col]}</${col}>`)
                    .join("")}
                </row>
              `
                )
                .join("")}
            </table>
          `;
        //const xmlString = JSON.stringify(data);
        return json_response(table, xmlString, export_format);
      }
    default:
      throw new Error("Unsupported export format");
  }
};

module.exports = {
  name: "Export data to file",
  display_state_form: false,
  get_state_fields,
  configuration_workflow,
  run,
  initial_config,

  routes: { do_download },
};
