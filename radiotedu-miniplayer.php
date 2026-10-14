<?php
/**
 * Plugin Name:       RadioTEDU Mini Player
 * Description:       Oynatıcı çubuğuna Picture-in-Picture mini oynatıcı ekler (masaüstü Chrome/Edge). Temaya dokunmaz; devre dışı bırakınca tamamen kalkar.
 * Version:           1.0.0
 * Requires at least: 5.0
 * Requires PHP:      7.0
 * Text Domain:       radiotedu-miniplayer
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'wp_enqueue_scripts',
	function () {
		$file = plugin_dir_path( __FILE__ ) . 'radiotedu-miniplayer.js';
		if ( ! file_exists( $file ) ) {
			return;
		}
		// Load after the theme's player script when it is registered (handle of assets/js/app.js).
		$deps = wp_script_is( 'radiotedu-app', 'registered' ) ? array( 'radiotedu-app' ) : array();
		wp_enqueue_script(
			'radiotedu-miniplayer',
			plugins_url( 'radiotedu-miniplayer.js', __FILE__ ),
			$deps,
			(string) filemtime( $file ),
			true
		);
	},
	20
);
