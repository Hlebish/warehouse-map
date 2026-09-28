# Firebase Realtime Database rules

`database.rules.json` lets signed-in users read the warehouse. Only the four editor accounts listed in the app may write warehouse data, including cells, history, imports, the unaddressed-items trash, and the last-import undo point.

The rules are not active until deployed to Firebase. Before deployment, inspect the current rules in Firebase Console because deploying this file replaces the database's current rules. Deploy from this project with an authorized Firebase CLI account:

```sh
firebase deploy --only database
```

Keep the editor email list in `database.rules.json` aligned with `EDITOR_EMAILS` in `index.html`.
