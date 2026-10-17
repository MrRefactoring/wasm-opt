(module
  (func $unused_a (result i32) (i32.const 42))
  (func $unused_b (param i32) (result i32) (i32.add (local.get 0) (i32.const 0)))
  (func $helper (param i32) (result i32)
    (local $scratch i32)
    (local.set $scratch (i32.const 0))
    (i32.add (local.get 0) (local.get $scratch)))
  (func (export "main") (param i32 i32) (result i32)
    (local $t i32)
    (local.set $t (i32.mul (local.get 0) (i32.const 1)))
    (i32.add
      (call $helper (local.get $t))
      (i32.sub (local.get 1) (i32.const 0))))
)
