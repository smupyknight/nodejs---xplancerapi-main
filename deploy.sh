#!/bin/sh
deployDir=/data/vivid_main_service
ServerName=${@:$OPTIND:1}
Rev="$(git rev-parse HEAD)"

echo $Rev

rm config/runtime.json
rsync -v -z -r --delete --progress -h --exclude=node_modules --exclude=doc --exclude=test --exclude=mycodes --exclude=deploy*  --exclude=test  --exclude=.* . $ServerName:$deployDir
ssh $ServerName  "cd $deployDir ; echo \"$Rev\">_rev.out; pwd; npm install; ls"

echo service deployed on:$ServerName:$deployDir
