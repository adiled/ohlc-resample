# Deprecated stuff that need attention

## Result of clean npm install with no package-lock.json

```sh
$ npm i
npm WARN deprecated har-validator@5.1.5: this library is no longer supported
npm WARN deprecated uuid@3.4.0: Please upgrade  to version 7 or higher.  Older versions may use Math.random() in certain circumstances, which is known 
to be problematic.  See https://v8.dev/blog/math-random for details.
npm WARN deprecated request@2.88.2: request has been deprecated, see https://github.com/request/request/issues/3142
```

```sh
/ohlc-resample
└─┬ coveralls@3.1.1
  └─┬ request@2.88.2
    └── uuid@3.4.0
```

```sh
/ohlc-resample
└─┬ coveralls@3.1.1
  └─┬ request@2.88.2
    └── har-validator@5.1.5
```

### Result of npm outdated

```sh
$ npm outdated
Package     Current  Wanted  Latest  Location                 Depended by
typescript   3.9.10  3.9.10   4.4.3  node_modules/typescript  ohlc-resample (updated to 4.4.3)
```
