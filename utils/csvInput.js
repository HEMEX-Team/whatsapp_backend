function escapeCsvField(field) {
  if (field === null || field === undefined) return '';
  return `"${String(field).replace(/"/g, '""')}"`;
}

module.exports = {
    escapeCsvField
}