// Returns true if the message is from a group chat
const checkIsPrivateMessage = async (message) => {
  const chat = await message.getChat();
  if (chat.isGroup) {
    console.log('Skipping group message');
    return false;
  }
  if (message.from.split('@')[1] === 'newsletter') {
    console.log('Skipping newsletter message');
    return false;
  }
  return true;
};

// Downloads media if present and under 10MB
const checkMedia = async (message) => {
  if (message.hasMedia) {
    const media = await message.downloadMedia();
    if (media) {
      const mediaSizeMB = Buffer.from(media.data, 'base64').length / (1024 * 1024);
      if (mediaSizeMB > 10) {
        // Media size exceeds 10MB
        return { media: null, mediaSizeMB: null };
      }
      return { media, mediaSizeMB };
    }
  }
  return null;
};

module.exports = {
  checkIsPrivateMessage,
  checkMedia,
};
