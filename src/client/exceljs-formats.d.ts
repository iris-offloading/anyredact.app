// Excel's built-in number formats by id, shipped inside ExcelJS.
declare module 'exceljs/lib/xlsx/defaultnumformats.js' {
  const formats: Record<string, { f?: string; 'en-us'?: string }>;
  export default formats;
}
