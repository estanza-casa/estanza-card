import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { cardVerdictPath, loadDemoHome, sharedHomePath } from './home.mjs';

const repaintedRoom = 'living-room';
const repaintedFloor = '#7a5230';
const verdicts = ['ok', 'suggested', 'required'];

const command = process.argv[2];

if (command === 'publish') publish();
else if (command === 'republish') republish();
else if (command === 'revoke') revoke();
else if (command === 'verdict') verdict(process.argv[3]);
else {
  console.error(
    'Usage: node dev/share.mjs <publish|republish|revoke|verdict ok|suggested|required>',
  );
  process.exit(1);
}

function verdict(update) {
  if (!verdicts.includes(update)) {
    console.error(`The verdict is one of ${verdicts.join(', ')}`);
    process.exit(1);
  }

  writeFileSync(cardVerdictPath, `${update}\n`);
  console.log(`The stub now answers X-Estanza-Card-Update: ${update}`);
}

function publish() {
  write(loadDemoHome());
  console.log(`Published Casa Aurora at ${sharedHomePath}`);
}

function republish() {
  const home = existsSync(sharedHomePath)
    ? JSON.parse(readFileSync(sharedHomePath, 'utf8'))
    : loadDemoHome();
  const original = loadDemoHome();
  const [id, room] = Object.entries(home.rooms).find(
    ([, entry]) => entry.slug === repaintedRoom,
  );
  const before = original.rooms[id].floorColor;

  room.floorColor =
    room.floorColor === repaintedFloor ? before : repaintedFloor;
  write(home);
  console.log(
    `Republished with the ${repaintedRoom} floor in ${room.floorColor}`,
  );
}

function revoke() {
  rmSync(sharedHomePath, { force: true });
  console.log('Revoked the share, the stub now answers 404');
}

function write(home) {
  writeFileSync(sharedHomePath, `${JSON.stringify(home, null, 2)}\n`);
}
