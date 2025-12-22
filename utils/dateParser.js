function parseDDMMYYYY(dateStr) {
    const regex = /^(\d{2})-(\d{2})-(\d{4})$/;
    const match = dateStr.match(regex);
    if (!match) return null;
    const [ , day, month, year ] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return isNaN(date.getTime()) ? null : date;
}

module.exports = {
    parseDDMMYYYY
}