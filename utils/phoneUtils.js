function parsePhoneNumber(number) {
  try{
    if(number.startsWith("+")) return number;
    const _number = "+" + number.split("@")[0]
    return _number;
  }catch(error){
    throw error;
  }
}

function getChatId(number) {
  try {
    const cleanNumber = number.replace('+', '');
    const suffix = cleanNumber.length > 12 ? '@g.us' : '@c.us';
    return cleanNumber + suffix;
  } catch (error) {
    throw error;
  }
}

module.exports = { parsePhoneNumber, getChatId };
