#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'openssl'
require 'securerandom'
require 'base64'
require 'uri'

ITERATIONS = 210_000
KEY_LENGTH = 32
CIPHER_NAME = 'aes-256-gcm'

OUTPUT_PATH = ARGV[0] || 'vaults/max_vault.json'
password = ENV['VAULT_PASSWORD']

abort('Usage: VAULT_PASSWORD=secret ruby scripts/build_vault.rb [output_path] <youtube_url_or_id> [...]') if password.to_s.empty? || ARGV[1..].to_a.empty?

sources = ARGV[1..]

def extract_video_id(source)
  text = source.to_s.strip
  return text if text.match?(/\A[a-zA-Z0-9_-]{11}\z/)

  uri = URI.parse(text)

  if uri.host&.include?('youtu.be')
    candidate = uri.path.split('/').reject(&:empty?).first
    return candidate if candidate&.match?(/\A[a-zA-Z0-9_-]{11}\z/)
  end

  if uri.host&.include?('youtube')
    params = URI.decode_www_form(uri.query.to_s).to_h
    candidate = params['v']
    return candidate if candidate&.match?(/\A[a-zA-Z0-9_-]{11}\z/)
  end

  raise ArgumentError, "Could not extract a valid YouTube video id from: #{source}"
rescue URI::InvalidURIError
  raise ArgumentError, "Invalid URL or video id: #{source}"
end

videos = sources.each_with_index.map do |source, index|
  {
    id: extract_video_id(source),
    title: format('Legacy Session %<number>02d', number: index + 1),
    note: index.zero? ? 'Prototype lesson access' : 'Private archive playback'
  }
end

plaintext = JSON.generate(videos)
salt = SecureRandom.random_bytes(16)
iv = SecureRandom.random_bytes(12)
key = OpenSSL::PKCS5.pbkdf2_hmac(password, salt, ITERATIONS, KEY_LENGTH, 'sha256')
cipher = OpenSSL::Cipher.new(CIPHER_NAME).encrypt
cipher.key = key
cipher.iv = iv
ciphertext = cipher.update(plaintext) + cipher.final
tag = cipher.auth_tag

payload = {
  version: 1,
  cipher: CIPHER_NAME,
  kdf: 'PBKDF2',
  digest: 'SHA-256',
  iterations: ITERATIONS,
  salt: Base64.strict_encode64(salt),
  iv: Base64.strict_encode64(iv),
  ciphertext: Base64.strict_encode64(ciphertext),
  tag: Base64.strict_encode64(tag)
}

File.write(OUTPUT_PATH, JSON.pretty_generate(payload))
puts "Wrote #{OUTPUT_PATH} with #{videos.length} encrypted video entr#{videos.length == 1 ? 'y' : 'ies'}."
