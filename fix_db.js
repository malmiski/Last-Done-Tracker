const fs = require('fs');
let path = 'ActivityTracker/src/utils/database.ts';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(/<<<<<<< HEAD[\s\S]*?=======\n/g, "");
content = content.replace(/>>>>>>> 3fe7b83 \(Support multiple photos and robust large image viewing\)\n/g, "");
fs.writeFileSync(path, content, 'utf8');

path = 'ActivityTracker/src/utils/database.web.ts';
content = fs.readFileSync(path, 'utf8');
content = content.replace(/<<<<<<< HEAD[\s\S]*?=======\n/g, "");
content = content.replace(/>>>>>>> 3fe7b83 \(Support multiple photos and robust large image viewing\)\n/g, "");
fs.writeFileSync(path, content, 'utf8');

path = 'ActivityTracker/src/utils/csv.ts';
content = fs.readFileSync(path, 'utf8');
content = content.replace(/<<<<<<< HEAD[\s\S]*?=======\n/g, "");
content = content.replace(/>>>>>>> 3fe7b83 \(Support multiple photos and robust large image viewing\)\n/g, "");
fs.writeFileSync(path, content, 'utf8');

path = 'ActivityTracker/src/hooks/useActivityData.ts';
content = fs.readFileSync(path, 'utf8');
content = content.replace(/<<<<<<< HEAD[\s\S]*?=======\n/g, "");
content = content.replace(/>>>>>>> 3fe7b83 \(Support multiple photos and robust large image viewing\)\n/g, "");
fs.writeFileSync(path, content, 'utf8');
