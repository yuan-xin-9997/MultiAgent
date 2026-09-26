#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "$MA_GITHUB_TOKEN" ;;
  *) printf '\n' ;;
esac
