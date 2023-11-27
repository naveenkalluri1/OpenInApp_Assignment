const express = require('express');
const path = require('path');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');

const app = express();
const port = 8000;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://mail.google.com/',
];

const labelName = 'Vacation Auto-Reply';

async function createLabel(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  try {
    console.log('Creating label');
    const response = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    console.log('Label created');
    return response.data.id;
  } catch (error) {
    if (error.code === 409) {
      console.log('Label already exists');
      const response = await gmail.users.labels.list({
        userId: 'me',
      });
      const label = response.data.labels.find(
        (label) => label.name === labelName
      );
      return label.id;
    } else {
      throw error;
    }
  }
}

async function getUnrepliedMessages(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  const response = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['INBOX'],
    q: 'is:unread',
  });

  return response.data.messages || [];
}

async function sendAutoReply(auth, message) {
  const gmail = google.gmail({ version: 'v1', auth });
  try {
    console.log('Sending auto-reply...');

    const fromAddress = message.payload.headers.find(header => header.name === 'From').value;
    const replyMessage = {
      userId: 'me',
      resource: {
        raw: Buffer.from(
          `To: ${fromAddress}\r\n` +
            `Subject: Re: ${message.payload.headers.find(header => header.name === 'Subject').value}\r\n` +
            `Content-Type: text/plain; charset="UTF-8"\r\n` +
            `Content-Transfer-Encoding: 7bit\r\n\r\n` +
            `Thank you for your email. I'm currently on vacation and will reply to you when I return.\r\n`
        ).toString('base64'),
      },
    };

    await gmail.users.messages.send(replyMessage);
    console.log('Auto-reply sent successfully.');
  } catch (error) {
    console.error('Error sending auto-reply:', error.message);
    throw error;
  }
}

async function processUnrepliedMessages(auth) {
  const labelId = await createLabel(auth);
  const gmail = google.gmail({ version: 'v1', auth });
  const messages = await getUnrepliedMessages(auth);

  for (const message of messages) {
    try {
      const email = await gmail.users.messages.get({
        auth,
        userId: 'me',
        id: message.id,
      });

      const hasReplied = email.data.payload.headers.some(
        (header) => header.name === 'In-Reply-To'
      );

      if (!hasReplied) {
        console.log(`Sending auto-reply to ${email.data.payload.headers.find(header => header.name === 'From').value}`);
        await sendAutoReply(auth, email.data);

        console.log('Auto-reply sent');

        await gmail.users.messages.modify({
          auth,
          userId: 'me',
          id: message.id,
          resource: {
            addLabelIds: [labelId],
            removeLabelIds: ['INBOX'],
          },
        });

        console.log('Message labeled and moved');
      }
    } catch (error) {
      console.error('Error processing message:', error.message);
    }
  }
}

async function main() {
  const auth = await authenticate({
    keyfilePath: path.join(__dirname, 'credentials.json'),
    scopes: SCOPES,
  });

  setInterval(async () => {
    console.log('Checking for unread messages');
    await processUnrepliedMessages(auth);
  }, Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000);
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  main();
});
