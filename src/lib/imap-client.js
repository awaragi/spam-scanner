export async function ensureFoldersExist() {
  console.log("Ensuring folders exist... (stub)");
}
export async function moveTrainedMessages(type) {
  console.log(`Moving trained messages to ${type === 'spam' ? 'Spam' : 'INBOX'} (stub)`);
}
export async function findFirstUIDOnDate(folder, since, write) {
  console.log(`Finding UID in ${folder} since ${since} (write: ${write})`);
  return { uid: 12345, internaldate: new Date().toISOString() };
}