module.exports = {
  sc_plugin_api_version: 1,
  plugin_name: "multi-format-data-transfer",
  viewtemplates: [require("./export_view")],
  actions: {
    import_csv_file: require("./import-file-action"),
    export_csv_to_file: require("./export-file-action"),
  },
};
