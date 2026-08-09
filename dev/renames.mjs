import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { callService, configDir, connectSocket, sleep } from './ha-client.mjs';

const journalPath = `${configDir}.estanza-renames.json`;

function readJournal() {
  if (!existsSync(journalPath)) return [];

  return JSON.parse(readFileSync(journalPath, 'utf8'));
}

function record(change) {
  writeFileSync(
    journalPath,
    `${JSON.stringify([...readJournal(), change], null, 2)}\n`,
  );
}

export async function renameEntity(token, entityId, newEntityId) {
  const socket = await connectSocket(token);

  try {
    const entry = await socket.send('config/entity_registry/update', {
      entity_id: entityId,
      new_entity_id: newEntityId,
    });

    record({ renamed: entityId, to: newEntityId });

    return entry.entity_entry ?? entry;
  } finally {
    socket.close();
  }
}

export async function deleteEntity(token, entityId) {
  const socket = await connectSocket(token);

  try {
    await socket.send('config/entity_registry/remove', {
      entity_id: entityId,
    });
    record({ deleted: entityId });
  } finally {
    socket.close();
  }
}

export async function restoreEntities(token) {
  const journal = readJournal();

  if (journal.length === 0) return 0;

  if (journal.some((change) => change.deleted)) {
    await callService(token, 'template', 'reload', {});
    await sleep(2000);
  }

  const socket = await connectSocket(token);

  try {
    for (const change of [...journal].reverse()) {
      if (!change.renamed) continue;

      await socket
        .send('config/entity_registry/update', {
          entity_id: change.to,
          new_entity_id: change.renamed,
        })
        .catch((error) => console.error(`Could not rename back: ${error}`));
    }
  } finally {
    socket.close();
  }

  rmSync(journalPath);

  return journal.length;
}
