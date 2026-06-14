(* TZIP-12 FA2 NFT with an on-chain token-id counter. `mint` is permissionless but the contract
   assigns the id (next_token_id), so ids never collide. Full FA2 surface (transfer / balance_of /
   update_operators) with operator checks + TZIP-12 token_metadata + TZIP-16 contract metadata.
   No image: metadata is name/symbol/decimals only (the dApp renders its own cover art). *)

type token_id = nat

type transfer_destination =
  [@layout:comb]
  { to_ : address; token_id : token_id; amount : nat }

type transfer_item =
  [@layout:comb]
  { from_ : address; txs : transfer_destination list }

type transfer_params = transfer_item list

type balance_of_request =
  [@layout:comb]
  { owner : address; token_id : token_id }

type balance_of_response =
  [@layout:comb]
  { request : balance_of_request; balance : nat }

type balance_of_params =
  [@layout:comb]
  { requests : balance_of_request list; callback : balance_of_response list contract }

type operator_param =
  [@layout:comb]
  { owner : address; operator : address; token_id : token_id }

type update_operator =
  [@layout:comb]
  | Add_operator of operator_param
  | Remove_operator of operator_param

type update_operators_params = update_operator list

type token_metadata_value =
  [@layout:comb]
  { token_id : token_id; token_info : (string, bytes) map }

type storage = {
  ledger : (token_id, address) big_map;                      (* token_id -> owner *)
  operators : (address * address * token_id, unit) big_map;  (* (owner, operator, token_id) *)
  token_metadata : (token_id, token_metadata_value) big_map;
  metadata : (string, bytes) big_map;                        (* TZIP-16 contract metadata *)
  next_token_id : nat;
}

type return = operation list * storage

let err_token_undefined = "FA2_TOKEN_UNDEFINED"
let err_insufficient = "FA2_INSUFFICIENT_BALANCE"
let err_not_operator = "FA2_NOT_OPERATOR"
let err_not_owner = "FA2_NOT_OWNER"

[@entry]
let transfer (p : transfer_params) (s : storage) : return =
  let process_item (s, item : storage * transfer_item) : storage =
    let from_ = item.from_ in
    let process_tx (s, tx : storage * transfer_destination) : storage =
      if tx.amount = 0n then s                       (* zero-amount transfer is a no-op *)
      else if tx.amount <> 1n then (failwith err_insufficient : storage)
      else
        let owner =
          match Big_map.find_opt tx.token_id s.ledger with
          | Some o -> o
          | None -> (failwith err_token_undefined : address)
        in
        let () = if owner <> from_ then failwith err_insufficient in
        let sender_ok =
          (Tezos.get_sender () = from_)
          || Big_map.mem (from_, Tezos.get_sender (), tx.token_id) s.operators
        in
        let () = if not sender_ok then failwith err_not_operator in
        { s with ledger = Big_map.update tx.token_id (Some tx.to_) s.ledger }
    in
    List.fold process_tx item.txs s
  in
  let s = List.fold process_item p s in
  (([] : operation list), s)

[@entry]
let balance_of (p : balance_of_params) (s : storage) : return =
  let resp (req : balance_of_request) : balance_of_response =
    let bal =
      match Big_map.find_opt req.token_id s.ledger with
      | Some o -> if o = req.owner then 1n else 0n
      | None -> (failwith err_token_undefined : nat)
    in
    { request = req; balance = bal }
  in
  let responses = List.map resp p.requests in
  let op = Tezos.transaction responses 0mutez p.callback in
  ([op], s)

[@entry]
let update_operators (p : update_operators_params) (s : storage) : return =
  let process (s, u : storage * update_operator) : storage =
    let param = match u with Add_operator pm -> pm | Remove_operator pm -> pm in
    let () = if Tezos.get_sender () <> param.owner then failwith err_not_owner in
    let key = (param.owner, param.operator, param.token_id) in
    match u with
    | Add_operator _ -> { s with operators = Big_map.update key (Some ()) s.operators }
    | Remove_operator _ -> { s with operators = Big_map.remove key s.operators }
  in
  let s = List.fold process p s in
  (([] : operation list), s)

[@entry]
let mint (to_ : address) (s : storage) : return =
  let tid = s.next_token_id in
  (* name="objkt demo", symbol="ODEMO", decimals="0" (raw UTF-8 bytes per TZIP-12) *)
  let info : (string, bytes) map =
    Map.literal [
      ("name", 0x6f626a6b742064656d6f);
      ("symbol", 0x4f44454d4f);
      ("decimals", 0x30)
    ]
  in
  let s =
    { s with
      ledger = Big_map.update tid (Some to_) s.ledger;
      token_metadata =
        Big_map.update tid (Some { token_id = tid; token_info = info }) s.token_metadata;
      next_token_id = tid + 1n }
  in
  (([] : operation list), s)
