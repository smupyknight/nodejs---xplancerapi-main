#!/bin/sh
proxy=wfront_azure_hk
proxyDir=/data/deploy_proxy/vivid_main_service

deployDir=/data/vivid_main_service
ServerName=${@:$OPTIND:1}
Rev="$(git rev-parse HEAD)"

echo $Rev
rm config/runtime.json

rsync -v -z -r --delete --progress -h --exclude=node_modules --exclude=test --exclude=mycodes --exclude=doc --exclude=deploy.sh --exclude=.* . $proxy:$proxyDir
echo sync to proxy $proxy $proxyDir done
echo "$ServerName $deployDir"
ssh  $proxy "cd $proxyDir; echo \"$Rev\">_rev.out; rsync -v -z -r --delete --progress -h --exclude=node_modules --exclude=deploy*.sh . $ServerName:$deployDir; ./deploy_init_remote_env.sh $ServerName $deployDir"

echo service deployed on:$ServerName:$deployDir
